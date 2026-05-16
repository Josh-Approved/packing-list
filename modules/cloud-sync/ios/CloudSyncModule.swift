import ExpoModulesCore
import CloudKit

/**
 * CloudSync — minimal wrapper over the *private* CloudKit database.
 *
 * One record type, "Trip"; recordName == the app's trip id. The whole trip
 * is a JSON string in `payload`; `modifiedAt` is the trip's updatedAt (ms
 * since epoch, Double); `deleted` is a soft-delete tombstone flag (0/1).
 * Last-writer-wins by `modifiedAt` is decided in the JS sync layer — this
 * module is deliberately thin: account status, fetch-all, upsert.
 *
 * Private DB == the user's own iCloud; nothing is shared, nothing is ours.
 * If the device has no iCloud account every call degrades gracefully and
 * the app stays fully local (the JS layer treats "noAccount" as a no-op).
 */
public class CloudSyncModule: Module {
  private let container = CKContainer(identifier: "iCloud.com.joshapproved.packinglist")
  private var db: CKDatabase { container.privateCloudDatabase }
  private let recordType = "Trip"

  public func definition() -> ModuleDefinition {
    Name("CloudSync")

    AsyncFunction("accountStatus") { () async throws -> String in
      let status = try await self.container.accountStatus()
      switch status {
      case .available: return "available"
      case .noAccount: return "noAccount"
      case .restricted: return "restricted"
      case .temporarilyUnavailable: return "temporarilyUnavailable"
      case .couldNotDetermine: return "couldNotDetermine"
      @unknown default: return "couldNotDetermine"
      }
    }

    // Fetch every Trip record in the private DB, following query cursors so
    // libraries larger than one page still come back whole.
    AsyncFunction("fetchAll") { () async throws -> [[String: Any]] in
      var out: [[String: Any]] = []
      let query = CKQuery(recordType: self.recordType, predicate: NSPredicate(value: true))

      var cursor: CKQueryOperation.Cursor? = nil
      repeat {
        let page: (matchResults: [(CKRecord.ID, Result<CKRecord, Error>)], queryCursor: CKQueryOperation.Cursor?)
        if let c = cursor {
          page = try await self.db.records(continuingMatchFrom: c)
        } else {
          page = try await self.db.records(matching: query)
        }
        for (_, result) in page.matchResults {
          if case .success(let record) = result {
            let id = record.recordID.recordName
            let payload = (record["payload"] as? String) ?? ""
            let modifiedAt = (record["modifiedAt"] as? Double) ?? 0
            let deleted = ((record["deleted"] as? Int) ?? 0) == 1
            out.append([
              "id": id,
              "payload": payload,
              "modifiedAt": modifiedAt,
              "deleted": deleted,
            ])
          }
        }
        cursor = page.queryCursor
      } while cursor != nil

      return out
    }

    // Upsert one trip (or write its tombstone). The JS layer only calls this
    // when local is the newer side; we still re-check on a server-record
    // conflict so a racing device can't be silently clobbered.
    AsyncFunction("putTrip") { (id: String, payload: String, modifiedAt: Double, deleted: Bool) async throws in
      let recordID = CKRecord.ID(recordName: id)

      func apply(to record: CKRecord) {
        record["payload"] = payload as CKRecordValue
        record["modifiedAt"] = modifiedAt as CKRecordValue
        record["deleted"] = (deleted ? 1 : 0) as CKRecordValue
      }

      let record: CKRecord
      do {
        record = try await self.db.record(for: recordID)
        // Server is newer than what we're trying to write → server wins,
        // skip. The next fetchAll will pull the server copy down.
        if let serverModified = record["modifiedAt"] as? Double, serverModified > modifiedAt {
          return
        }
      } catch let ckErr as CKError where ckErr.code == .unknownItem {
        record = CKRecord(recordType: self.recordType, recordID: recordID)
      }

      apply(to: record)

      do {
        _ = try await self.db.save(record)
      } catch let ckErr as CKError where ckErr.code == .serverRecordChanged {
        // Lost a write race. Re-apply onto the server's record only if we
        // are still the newer writer; otherwise accept the server copy.
        if let serverRecord = ckErr.serverRecord {
          let serverModified = serverRecord["modifiedAt"] as? Double ?? 0
          if modifiedAt >= serverModified {
            apply(to: serverRecord)
            _ = try await self.db.save(serverRecord)
          }
        }
      }
    }
  }
}
