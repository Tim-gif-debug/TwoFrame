import UIKit
import Capacitor

// The app's main screen: Capacitor's web view with TwoFrame in it, plus TwoFrame's own native helper.
class TFBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TFNativePlugin())
    }
}
