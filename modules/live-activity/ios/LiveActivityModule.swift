import ActivityKit
import ExpoModulesCore
import Foundation

struct TaskRecord: Record {
  @Field var taskId: String = ""
  @Field var title: String = ""
  @Field var subtitle: String = ""
  @Field var symbol: String = "circle.fill"
  @Field var accentHex: String = "#C9974A"
  @Field var startEpoch: Double = 0
  @Field var endEpoch: Double = 0
  @Field var priority: String = "medium"
  @Field var isRunning: Bool = false
}

public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    // Returns the ids of all running Day Planner activities.
    Function("running") { () -> [String] in
      if #available(iOS 16.2, *) {
        return Activity<DayPlannerAttributes>.activities.map { $0.id }
      }
      return []
    }

    AsyncFunction("start") { (task: TaskRecord) throws -> String in
      guard #available(iOS 16.2, *) else {
        throw Exception(
          name: "Unsupported",
          description: "Live Activities require iOS 16.2 or newer."
        )
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else {
        throw Exception(
          name: "Disabled",
          description: "Live Activities are disabled in Settings."
        )
      }

      let attributes = DayPlannerAttributes(taskId: task.taskId)
      let state = DayPlannerAttributes.ContentState(
        title: task.title,
        subtitle: task.subtitle,
        symbol: task.symbol,
        accentHex: task.accentHex,
        startEpoch: task.startEpoch,
        endEpoch: task.endEpoch,
        priority: task.priority,
        isRunning: task.isRunning
      )
      let stale = Date(timeIntervalSince1970: task.endEpoch)
      let content = ActivityContent(state: state, staleDate: stale)
      let activity = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil
      )
      return activity.id
    }

    AsyncFunction("update") { (id: String, task: TaskRecord) in
      guard #available(iOS 16.2, *) else { return }
      guard
        let activity = Activity<DayPlannerAttributes>.activities
          .first(where: { $0.id == id })
      else { return }

      let state = DayPlannerAttributes.ContentState(
        title: task.title,
        subtitle: task.subtitle,
        symbol: task.symbol,
        accentHex: task.accentHex,
        startEpoch: task.startEpoch,
        endEpoch: task.endEpoch,
        priority: task.priority,
        isRunning: task.isRunning
      )
      let stale = Date(timeIntervalSince1970: task.endEpoch)
      await activity.update(ActivityContent(state: state, staleDate: stale))
    }

    AsyncFunction("end") { (id: String) in
      guard #available(iOS 16.2, *) else { return }
      guard
        let activity = Activity<DayPlannerAttributes>.activities
          .first(where: { $0.id == id })
      else { return }
      await activity.end(nil, dismissalPolicy: .immediate)
    }

    AsyncFunction("endAll") {
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<DayPlannerAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }

    // Brief toast surfaced in the Dynamic Island, auto-dismissed after ~4s.
    AsyncFunction("toast") { (message: String, kind: String) in
      guard #available(iOS 16.2, *) else { return }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

      let attributes = ToastAttributes(id: UUID().uuidString)
      let state = ToastAttributes.ContentState(message: message, kind: kind)
      let content = ActivityContent(
        state: state,
        staleDate: Date().addingTimeInterval(8)
      )
      guard
        let activity = try? Activity.request(
          attributes: attributes,
          content: content,
          pushType: nil
        )
      else { return }

      let id = activity.id
      DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
        Task {
          if let a = Activity<ToastAttributes>.activities.first(where: {
            $0.id == id
          }) {
            await a.end(nil, dismissalPolicy: .immediate)
          }
        }
      }
    }
  }
}
