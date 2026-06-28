import ActivityKit
import Foundation

// Transient "toast" surfaced in the Dynamic Island. Widget-side copy; the app
// module keeps an identical copy so ActivityKit matches by type name.
struct ToastAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var message: String
    var kind: String // "success" | "error" | "info"
  }

  var id: String
}
