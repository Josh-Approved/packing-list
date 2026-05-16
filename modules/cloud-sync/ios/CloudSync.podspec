require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CloudSync'
  s.version        = package['version'] || '1.0.0'
  s.summary        = 'Private-CloudKit trip sync for Packing List'
  s.description    = 'Local Expo module wrapping the private CloudKit database for trip backup/sync.'
  s.author         = 'Josh Approved'
  s.homepage       = 'https://github.com/josh-approved/packing-list'
  s.platforms      = { :ios => '16.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
