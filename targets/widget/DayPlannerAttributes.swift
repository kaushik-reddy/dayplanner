import ActivityKit
import Foundation

// Compiled into the WIDGET extension. The app side (bridge module) keeps its
// own identical copy; ActivityKit matches the running activity to this widget
// configuration by the attributes type name across the two binaries.
struct DayPlannerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// Task title, e.g. "Design review"
    var title: String
    /// Short context line, e.g. "with Priya · Meet"
    var subtitle: String
    /// SF Symbol name for the category, e.g. "person.2.fill"
    var symbol: String
    /// Accent color as #RRGGBB
    var accentHex: String
    /// Unix seconds the task starts
    var startEpoch: Double
    /// Unix seconds the task ends
    var endEpoch: Double
    /// "low" | "medium" | "high" | "must"
    var priority: String
    /// true once the task is in progress, false while it is still upcoming
    var isRunning: Bool
  }

  /// Stable identifier for the underlying planner task
  var taskId: String
}
