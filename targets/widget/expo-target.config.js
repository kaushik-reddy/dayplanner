/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "DayPlannerWidget",
  icon: "../../assets/images/icon.png",
  colors: {
    $accent: "#C9974A",
    $widgetBackground: "#15120C",
  },
  entitlements: {
    "com.apple.security.application-groups": [
      "group.com.kaushik4432.dayplanner",
    ],
  },
  frameworks: ["SwiftUI", "WidgetKit", "ActivityKit"],
});
