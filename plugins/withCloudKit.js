/**
 * Expo config plugin — CloudKit private-database entitlement.
 *
 * Adds the iCloud/CloudKit capability to the iOS target at prebuild so the
 * native cloud-sync module can reach `CKContainer(identifier:).privateCloudDatabase`.
 * No file ubiquity, no key-value store, no push — private CloudKit only.
 *
 * One-time external step this plugin can't do (same class as the ASC key /
 * WWDR steps): in the Apple Developer portal the App ID
 * `com.joshapproved.packinglist` must have the iCloud capability enabled and
 * a CloudKit container `iCloud.com.joshapproved.packinglist` created. EAS
 * managed credentials then carry the entitlement on the next build.
 */

const { withEntitlementsPlist } = require('@expo/config-plugins');

const CONTAINER = 'iCloud.com.joshapproved.packinglist';

const withCloudKit = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    cfg.modResults['com.apple.developer.icloud-container-identifiers'] = [CONTAINER];
    cfg.modResults['com.apple.developer.icloud-services'] = ['CloudKit'];
    // Containers list mirrors the identifiers list; Apple requires both keys.
    cfg.modResults['com.apple.developer.ubiquity-container-identifiers'] = [];
    return cfg;
  });

module.exports = withCloudKit;
