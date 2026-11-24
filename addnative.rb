# Adds TwoFrame's native files to the App target of the Xcode project that `npx cap add ios` made,
# and points the main screen at TwoFrame's own view controller (which registers the native helper).
require 'xcodeproj'
proj_path = File.join(__dir__, '..', 'ios', 'App', 'App.xcodeproj')
proj = Xcodeproj::Project.open(proj_path)
target = proj.targets.find { |t| t.name == 'App' } or abort('No App target')
group = proj.main_group.find_subpath('App', false) or abort('No App group')
%w[TFNativePlugin.swift TFBridgeViewController.swift].each do |f|
  next if group.files.any? { |r| r.path == f }
  ref = group.new_reference(f)
  target.source_build_phase.add_file_reference(ref, true)
  puts "Added #{f}"
end
unless group.files.any? { |r| r.path == 'PrivacyInfo.xcprivacy' }
  ref = group.new_reference('PrivacyInfo.xcprivacy')
  target.resources_build_phase.add_file_reference(ref, true)
  puts 'Added PrivacyInfo.xcprivacy'
end
proj.save
board = File.join(__dir__, '..', 'ios', 'App', 'App', 'Base.lproj', 'Main.storyboard')
s = File.read(board)
s2 = s.gsub(/customClass="CAPBridgeViewController" customModule="Capacitor"/, 'customClass="TFBridgeViewController" customModule="App" customModuleProvider="target"')
abort('Main.storyboard was not changed; check its view controller class') if s2 == s
File.write(board, s2)
puts 'Main screen now uses TFBridgeViewController'
