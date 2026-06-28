import ActivityKit
import Foundation

// App-side copy of the Live Activity attributes. Must stay byte-for-byte in
// sync with targets/widget/DayPlannerAttributes.swift so the system matches the
// running activity to the widget's ActivityConfiguration by type name.
struct DayPlannerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var title: String
    var subtitle: String
    var symbol: String
    var accentHex: String
    var startEpoch: Double
    var endEpoch: Double
    var priority: String
    var isRunning: Bool
  }

  var taskId: String
}
