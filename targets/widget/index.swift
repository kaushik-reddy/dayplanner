import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Helpers

extension Color {
  init(hex: String) {
    let s = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    var rgb: UInt64 = 0
    Scanner(string: s).scanHexInt64(&rgb)
    let r, g, b: Double
    if s.count == 6 {
      r = Double((rgb & 0xFF0000) >> 16) / 255
      g = Double((rgb & 0x00FF00) >> 8) / 255
      b = Double(rgb & 0x0000FF) / 255
    } else {
      r = 0.79; g = 0.59; b = 0.29 // brass fallback
    }
    self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
  }
}

private let brass = Color(hex: "#C9974A")
private let ink = Color(hex: "#15120C")

private func startDate(_ s: DayPlannerAttributes.ContentState) -> Date {
  Date(timeIntervalSince1970: s.startEpoch)
}
private func endDate(_ s: DayPlannerAttributes.ContentState) -> Date {
  Date(timeIntervalSince1970: s.endEpoch)
}

private func priorityLabel(_ p: String) -> String {
  switch p {
  case "must": return "MUST"
  case "high": return "HIGH"
  case "medium": return "MED"
  default: return "LOW"
  }
}
private func priorityColor(_ p: String) -> Color {
  switch p {
  case "must": return Color(hex: "#E5484D")
  case "high": return Color(hex: "#E0903C")
  case "medium": return Color(hex: "#C9974A")
  default: return Color(hex: "#6B7B5A")
  }
}

private func timeRange(_ s: DayPlannerAttributes.ContentState) -> String {
  let f = DateFormatter()
  f.dateFormat = "h:mm a"
  return "\(f.string(from: startDate(s))) – \(f.string(from: endDate(s)))"
}

// MARK: - Shared bits

private struct AccentBadge: View {
  let symbol: String
  let accent: Color
  var size: CGFloat = 34
  var body: some View {
    ZStack {
      Circle().fill(accent.opacity(0.18))
      Circle().strokeBorder(accent.opacity(0.55), lineWidth: 1)
      Image(systemName: symbol)
        .font(.system(size: size * 0.42, weight: .semibold))
        .foregroundStyle(accent)
    }
    .frame(width: size, height: size)
  }
}

private struct PriorityPill: View {
  let priority: String
  var body: some View {
    Text(priorityLabel(priority))
      .font(.system(size: 10, weight: .heavy, design: .rounded))
      .tracking(0.5)
      .foregroundStyle(priorityColor(priority))
      .padding(.horizontal, 7)
      .padding(.vertical, 3)
      .background(
        Capsule().fill(priorityColor(priority).opacity(0.16))
      )
  }
}

private struct CountdownText: View {
  let state: DayPlannerAttributes.ContentState
  var font: Font = .system(size: 14, weight: .semibold, design: .rounded)
  var body: some View {
    let target = state.isRunning ? endDate(state) : startDate(state)
    Text(timerInterval: Date()...target, countsDown: true)
      .font(font)
      .monospacedDigit()
      .multilineTextAlignment(.trailing)
  }
}

private struct LiveProgress: View {
  let state: DayPlannerAttributes.ContentState
  let accent: Color
  var body: some View {
    ProgressView(
      timerInterval: startDate(state)...endDate(state),
      countsDown: false
    ) {
      EmptyView()
    } currentValueLabel: {
      EmptyView()
    }
    .progressViewStyle(.linear)
    .tint(accent)
    .labelsHidden()
  }
}

// MARK: - Lock Screen / banner

private struct LockScreenView: View {
  let state: DayPlannerAttributes.ContentState
  var body: some View {
    let accent = Color(hex: state.accentHex)
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .top, spacing: 11) {
        AccentBadge(symbol: state.symbol, accent: accent, size: 38)
        VStack(alignment: .leading, spacing: 2) {
          Text(state.title)
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(1)
          if !state.subtitle.isEmpty {
            Text(state.subtitle)
              .font(.system(size: 12.5, weight: .medium))
              .foregroundStyle(.white.opacity(0.62))
              .lineLimit(1)
          }
        }
        Spacer(minLength: 6)
        VStack(alignment: .trailing, spacing: 4) {
          PriorityPill(priority: state.priority)
          Text(state.isRunning ? "ends in" : "in")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(.white.opacity(0.45))
          CountdownText(
            state: state,
            font: .system(size: 15, weight: .bold, design: .rounded)
          )
          .foregroundStyle(accent)
          .frame(maxWidth: 70, alignment: .trailing)
        }
      }
      LiveProgress(state: state, accent: accent)
        .frame(height: 5)
      HStack {
        Image(systemName: "clock")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(.white.opacity(0.45))
        Text(timeRange(state))
          .font(.system(size: 11.5, weight: .medium, design: .rounded))
          .foregroundStyle(.white.opacity(0.6))
        Spacer()
        Text(state.isRunning ? "In progress" : "Up next")
          .font(.system(size: 11, weight: .semibold, design: .rounded))
          .foregroundStyle(accent.opacity(0.9))
      }
    }
    .padding(14)
    .background(ink)
    .activityBackgroundTint(ink)
    .activitySystemActionForegroundColor(accent)
  }
}

// MARK: - Live Activity + Dynamic Island

struct DayPlannerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DayPlannerAttributes.self) { context in
      LockScreenView(state: context.state)
    } dynamicIsland: { context in
      let s = context.state
      let accent = Color(hex: s.accentHex)
      return DynamicIsland {
        // Expanded
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 8) {
            AccentBadge(symbol: s.symbol, accent: accent, size: 30)
            PriorityPill(priority: s.priority)
          }
          .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          VStack(alignment: .trailing, spacing: 1) {
            Text(s.isRunning ? "ends in" : "starts in")
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(.white.opacity(0.45))
            CountdownText(
              state: s,
              font: .system(size: 19, weight: .bold, design: .rounded)
            )
            .foregroundStyle(accent)
            .frame(maxWidth: 86, alignment: .trailing)
          }
          .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 1) {
            Text(s.title)
              .font(.system(size: 15, weight: .bold, design: .rounded))
              .foregroundStyle(.white)
              .lineLimit(1)
            if !s.subtitle.isEmpty {
              Text(s.subtitle)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.white.opacity(0.55))
                .lineLimit(1)
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 5) {
            LiveProgress(state: s, accent: accent)
              .frame(height: 5)
            HStack {
              Image(systemName: "clock")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(.white.opacity(0.4))
              Text(timeRange(s))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.55))
              Spacer()
              Text(s.isRunning ? "In progress" : "Up next")
                .font(.system(size: 10.5, weight: .semibold, design: .rounded))
                .foregroundStyle(accent.opacity(0.9))
            }
          }
        }
      } compactLeading: {
        AccentBadge(symbol: s.symbol, accent: accent, size: 22)
      } compactTrailing: {
        CountdownText(
          state: s,
          font: .system(size: 13, weight: .semibold, design: .rounded)
        )
        .foregroundStyle(accent)
        .frame(maxWidth: 44, alignment: .trailing)
      } minimal: {
        ZStack {
          Circle().stroke(accent.opacity(0.5), lineWidth: 1.5)
          Image(systemName: s.symbol)
            .font(.system(size: 10, weight: .bold))
            .foregroundStyle(accent)
        }
      }
      .keylineTint(accent)
    }
  }
}

// MARK: - Widget bundle entry point

@main
struct DayPlannerWidgetBundle: WidgetBundle {
  var body: some Widget {
    DayPlannerLiveActivity()
    ToastLiveActivity()
  }
}
