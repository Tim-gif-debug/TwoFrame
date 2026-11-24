import Foundation
import UIKit
import Vision
import CoreImage
import Photos
import Capacitor

// TwoFrame's native helper. Called from the editor's JavaScript (js/native/native.js).
//   check        what this phone is and a real speed test of Apple's person cutout
//   mask         one cutout mask for one picture
//   endSession   forget the video state kept between frames
//   fileBegin / fileAppend / fileFinish   save a file to Photos or the share sheet
@objc(TFNativePlugin)
public class TFNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TFNativePlugin"
    public let jsName = "TFNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mask", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileBegin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileAppend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileFinish", returnType: CAPPluginReturnPromise),
    ]

    private let work = DispatchQueue(label: "twoframe.cutout", qos: .userInitiated)
    private let ci = CIContext(options: [.cacheIntermediates: false])
    // Video: one sequence handler and one request per session, so Apple's model can keep the mask steady from frame to frame.
    private var sessions: [String: (VNSequenceRequestHandler, VNGeneratePersonSegmentationRequest)] = [:]
    private var files: [String: URL] = [:]

    // MARK: - Phone check

    @objc func check(_ call: CAPPluginCall) {
        work.async {
            var r: [String: Any] = [:]
            let id = TFNativePlugin.modelIdentifier()
            let info = TFNativePlugin.describe(id)
            r["model"] = id
            r["name"] = info.name
            r["chip"] = info.chip
            let v = ProcessInfo.processInfo.operatingSystemVersion
            r["ios"] = v.patchVersion > 0 ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)" : "\(v.majorVersion).\(v.minorVersion)"
            r["memoryGB"] = Double(ProcessInfo.processInfo.physicalMemory) / 1_073_741_824.0
            r["lowPower"] = ProcessInfo.processInfo.isLowPowerModeEnabled
            switch ProcessInfo.processInfo.thermalState {
            case .nominal: r["thermal"] = "nominal"
            case .fair: r["thermal"] = "fair"
            case .serious: r["thermal"] = "serious"
            case .critical: r["thermal"] = "critical"
            @unknown default: r["thermal"] = "unknown"
            }
            if #available(iOS 15.0, *) { r["person"] = true } else { r["person"] = false }
            if #available(iOS 17.0, *) { r["subject"] = true } else { r["subject"] = false }
            // Real speed test: a made-up picture of a figure, cut out a few times. The first run includes loading Apple's model.
            if #available(iOS 15.0, *) {
                do {
                    let img = TFNativePlugin.testPicture()
                    var times: [Double] = []
                    for _ in 0..<4 {
                        let t0 = CFAbsoluteTimeGetCurrent()
                        let req = VNGeneratePersonSegmentationRequest()
                        req.qualityLevel = .accurate
                        req.outputPixelFormat = kCVPixelFormatType_OneComponent8
                        try VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
                        times.append((CFAbsoluteTimeGetCurrent() - t0) * 1000)
                    }
                    r["firstMs"] = times[0]
                    let warm = Array(times.dropFirst()).sorted()
                    r["ms"] = warm[warm.count / 2]
                } catch {
                    r["testError"] = error.localizedDescription
                }
            }
            call.resolve(r)
        }
    }

    // MARK: - Cutout

    @objc func mask(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"), let data = Data(base64Encoded: b64), let ui = UIImage(data: data), let cg = ui.cgImage else {
            call.reject("No picture was sent."); return
        }
        let w = max(16, call.getInt("w") ?? cg.width), h = max(16, call.getInt("h") ?? cg.height)
        let mode = call.getString("mode") ?? "video", session = call.getString("session") ?? ""
        work.async {
            guard #available(iOS 15.0, *) else { call.reject("Apple’s person cutout needs iOS 15 or later."); return }
            let t0 = CFAbsoluteTimeGetCurrent()
            do {
                var buf: CVPixelBuffer? = nil
                var found = true
                if mode == "photo" {
                    buf = try self.personMask(cg, session: "")
                    // Photos: if there is no person, Apple's subject cutout (iOS 17) can find a pet or an object.
                    if let b = buf, TFNativePlugin.coverage(b) < 0.004 {
                        if #available(iOS 17.0, *), let s = try self.subjectMask(cg) { buf = s } else { found = false }
                    }
                } else {
                    buf = try self.personMask(cg, session: session)
                }
                guard let b = buf, let png = self.png(b, w: w, h: h) else { call.reject("Apple’s cutout gave no mask."); return }
                if mode != "photo" { found = TFNativePlugin.coverage(b) >= 0.004 }
                call.resolve(["png": png.base64EncodedString(), "found": found, "ms": (CFAbsoluteTimeGetCurrent() - t0) * 1000])
            } catch {
                call.reject("Apple’s cutout failed: " + error.localizedDescription)
            }
        }
    }

    @objc func endSession(_ call: CAPPluginCall) {
        let s = call.getString("session") ?? ""
        work.async { self.sessions.removeValue(forKey: s); call.resolve() }
    }

    @available(iOS 15.0, *)
    private func personMask(_ cg: CGImage, session: String) throws -> CVPixelBuffer? {
        if session.isEmpty {
            let req = VNGeneratePersonSegmentationRequest()
            req.qualityLevel = .accurate
            req.outputPixelFormat = kCVPixelFormatType_OneComponent8
            try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
            return req.results?.first?.pixelBuffer
        }
        if sessions[session] == nil {
            if sessions.count > 4 { sessions.removeAll() }
            let req = VNGeneratePersonSegmentationRequest()
            req.qualityLevel = .accurate
            req.outputPixelFormat = kCVPixelFormatType_OneComponent8
            sessions[session] = (VNSequenceRequestHandler(), req)
        }
        let (handler, req) = sessions[session]!
        try handler.perform([req], on: cg)
        return req.results?.first?.pixelBuffer
    }

    @available(iOS 17.0, *)
    private func subjectMask(_ cg: CGImage) throws -> CVPixelBuffer? {
        let req = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try handler.perform([req])
        guard let obs = req.results?.first, !obs.allInstances.isEmpty else { return nil }
        return try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
    }

    // The mask, scaled to w by h, as a grey PNG.
    private func png(_ buf: CVPixelBuffer, w: Int, h: Int) -> Data? {
        let src = CIImage(cvPixelBuffer: buf)
        let sx = CGFloat(w) / src.extent.width, sy = CGFloat(h) / src.extent.height
        let scaled = src.transformed(by: CGAffineTransform(scaleX: sx, y: sy)).clampedToExtent().cropped(to: CGRect(x: 0, y: 0, width: w, height: h))
        guard let out = ci.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: w, height: h), format: .L8, colorSpace: CGColorSpaceCreateDeviceGray()) else { return nil }
        return UIImage(cgImage: out).pngData()
    }

    // Share of the picture the mask covers (0 to 1), from a quick sample.
    private static func coverage(_ buf: CVPixelBuffer) -> Double {
        CVPixelBufferLockBaseAddress(buf, .readOnly); defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buf) else { return 0 }
        let w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf), row = CVPixelBufferGetBytesPerRow(buf)
        let fmt = CVPixelBufferGetPixelFormatType(buf)
        var on = 0, n = 0
        for y in stride(from: 0, to: h, by: 4) {
            for x in stride(from: 0, to: w, by: 4) {
                let v: Double
                if fmt == kCVPixelFormatType_OneComponent32Float { v = Double(base.advanced(by: y * row + x * 4).assumingMemoryBound(to: Float32.self).pointee) }
                else { v = Double(base.advanced(by: y * row + x).assumingMemoryBound(to: UInt8.self).pointee) / 255.0 }
                if v > 0.5 { on += 1 }; n += 1
            }
        }
        return n > 0 ? Double(on) / Double(n) : 0
    }

    // A simple made-up figure on a plain background, for the speed test.
    private static func testPicture() -> CGImage {
        let size = CGSize(width: 1024, height: 576)
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 1
        let img = UIGraphicsImageRenderer(size: size, format: fmt).image { ctx in
            UIColor(red: 0.55, green: 0.6, blue: 0.5, alpha: 1).setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            UIColor(red: 0.85, green: 0.7, blue: 0.6, alpha: 1).setFill(); ctx.cgContext.fillEllipse(in: CGRect(x: 452, y: 110, width: 120, height: 150))
            UIColor(red: 0.2, green: 0.25, blue: 0.4, alpha: 1).setFill(); ctx.cgContext.fill(CGRect(x: 392, y: 260, width: 240, height: 316))
        }
        return img.cgImage!
    }

    // MARK: - Saving

    @objc func fileBegin(_ call: CAPPluginCall) {
        let name = (call.getString("name") ?? "TwoFrame").replacingOccurrences(of: "/", with: "-")
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(name)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            let id = UUID().uuidString
            files[id] = url
            call.resolve(["id": id])
        } catch { call.reject("Could not start the file: " + error.localizedDescription) }
    }

    @objc func fileAppend(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = files[id], let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else { call.reject("Bad file piece."); return }
        do {
            let h = try FileHandle(forWritingTo: url); defer { try? h.close() }
            try h.seekToEnd(); try h.write(contentsOf: data)
            call.resolve()
        } catch { call.reject("Could not write the file: " + error.localizedDescription) }
    }

    @objc func fileFinish(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = files.removeValue(forKey: id) else { call.reject("Unknown file."); return }
        let to = call.getString("to") ?? "share"
        let isVideo = ["mp4", "mov", "m4v"].contains(url.pathExtension.lowercased())
        let isImage = ["png", "jpg", "jpeg", "gif", "heic"].contains(url.pathExtension.lowercased())
        if to == "photos" && (isVideo || isImage) {
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else { DispatchQueue.main.async { self.share(url, call) }; return }
                PHPhotoLibrary.shared().performChanges({
                    if isVideo { PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: url) }
                    else { PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: url) }
                }) { ok, err in
                    if ok { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()); call.resolve(["result": "photos"]) }
                    else { DispatchQueue.main.async { self.share(url, call) } }
                }
            }
        } else {
            DispatchQueue.main.async { self.share(url, call) }
        }
    }

    private func share(_ url: URL, _ call: CAPPluginCall) {
        guard let vc = bridge?.viewController else { call.reject("No screen to show the share sheet on."); return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = sheet.popoverPresentationController { pop.sourceView = vc.view; pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1); pop.permittedArrowDirections = [] }
        sheet.completionWithItemsHandler = { _, done, _, _ in call.resolve(["result": done ? "shared" : "cancelled"]) }
        vc.present(sheet, animated: true)
    }

    // MARK: - Which phone

    static func modelIdentifier() -> String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return sim }
        var u = utsname(); uname(&u)
        return withUnsafePointer(to: &u.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) } }
    }

    // Names and chips of the iPhones that can run iOS 17. Newer models not in this list are still checked by the speed test.
    static func describe(_ id: String) -> (name: String, chip: String) {
        let t: [String: (String, String)] = [
            "iPhone11,2": ("iPhone XS", "A12 Bionic"), "iPhone11,4": ("iPhone XS Max", "A12 Bionic"), "iPhone11,6": ("iPhone XS Max", "A12 Bionic"), "iPhone11,8": ("iPhone XR", "A12 Bionic"),
            "iPhone12,1": ("iPhone 11", "A13 Bionic"), "iPhone12,3": ("iPhone 11 Pro", "A13 Bionic"), "iPhone12,5": ("iPhone 11 Pro Max", "A13 Bionic"), "iPhone12,8": ("iPhone SE (2nd generation)", "A13 Bionic"),
            "iPhone13,1": ("iPhone 12 mini", "A14 Bionic"), "iPhone13,2": ("iPhone 12", "A14 Bionic"), "iPhone13,3": ("iPhone 12 Pro", "A14 Bionic"), "iPhone13,4": ("iPhone 12 Pro Max", "A14 Bionic"),
            "iPhone14,4": ("iPhone 13 mini", "A15 Bionic"), "iPhone14,5": ("iPhone 13", "A15 Bionic"), "iPhone14,2": ("iPhone 13 Pro", "A15 Bionic"), "iPhone14,3": ("iPhone 13 Pro Max", "A15 Bionic"),
            "iPhone14,6": ("iPhone SE (3rd generation)", "A15 Bionic"), "iPhone14,7": ("iPhone 14", "A15 Bionic"), "iPhone14,8": ("iPhone 14 Plus", "A15 Bionic"),
            "iPhone15,2": ("iPhone 14 Pro", "A16 Bionic"), "iPhone15,3": ("iPhone 14 Pro Max", "A16 Bionic"), "iPhone15,4": ("iPhone 15", "A16 Bionic"), "iPhone15,5": ("iPhone 15 Plus", "A16 Bionic"),
            "iPhone16,1": ("iPhone 15 Pro", "A17 Pro"), "iPhone16,2": ("iPhone 15 Pro Max", "A17 Pro"),
            "iPhone17,1": ("iPhone 16 Pro", "A18 Pro"), "iPhone17,2": ("iPhone 16 Pro Max", "A18 Pro"), "iPhone17,3": ("iPhone 16", "A18"), "iPhone17,4": ("iPhone 16 Plus", "A18"), "iPhone17,5": ("iPhone 16e", "A18"),
        ]
        if let v = t[id] { return (v.0, v.1) }
        if id.hasPrefix("iPhone") { return ("iPhone (" + id + ")", "") }
        if id.hasPrefix("iPad") { return ("iPad (" + id + ")", "") }
        if id == "arm64" || id == "x86_64" { return ("Simulator", "") }
        return (id, "")
    }
}
