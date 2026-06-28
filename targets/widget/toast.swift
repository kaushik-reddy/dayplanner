import ActivityKit
import SwiftUI
import WidgetKit

private func toastColor(_ kind: String) -> Color {
  switch kind {
  case "error": return Color(hex: "#C97A6A")
  case "info": return Color(hex: "#7FA8C9")
  default: return Color(hex: "#6FA88A")
  }
}

private func toastSymbol(_ kind: String) -> String {
  switch kind {
  case "error": return "exclamationmark.triangle.fill"
  case "info": return "bell.fill"
  default: return "checkmark.circle.fill"
  }
}

struct ToastLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: ToastAttributes.self) { context in
      // Lock Screen / banner
      HStack(spacing: 12) {
        Image(systemName: toastSymbol(context.state.kind))
          .font(.system(size: 19, weight: .semibold))
          .foregroundStyle(toastColor(context.state.kind))
        Text(context.state.message)
          .font(.system(size: 14.5, weight: .semibold, design: .rounded))
          .foregroundStyle(.white)
          .lineLimit(2)
        Spacer(minLength: 0)
      }
      .padding(14)
      .background(Color(hex: "#0A0A0B"))
      .activityBackgroundTint(Color(hex: "#0A0A0B"))
      .activitySystemActionForegroundColor(toastColor(context.state.kind))
    } dynamicIsland: { context in
      let color = toastColor(context.state.kind)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: toastSymbol(context.state.kind))
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(color)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.message)
            .font(.system(size: 14.5, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      } compactLeading: {
        Image(systemName: toastSymbol(context.state.kind))
          .foregroundStyle(color)
      } compactTrailing: {
        Text(context.state.message)
          .font(.system(size: 12, weight: .semibold, design: .rounded))
          .foregroundStyle(color)
          .lineLimit(1)
          .frame(maxWidth: 96, alignment: .trailing)
      } minimal: {
        Image(systemName: toastSymbol(context.state.kind))
          .foregroundStyle(color)
      }
      .keylineTint(color)
    }
  }
}
