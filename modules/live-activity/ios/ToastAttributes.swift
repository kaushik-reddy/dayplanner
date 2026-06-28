import ActivityKit
import Foundation

// App-side copy — must stay identical to targets/widget/ToastAttributes.swift.
struct ToastAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var message: String
    var kind: String
  }

  var id: String
}
