// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RyperOSMobileIOS",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(name: "RyperOSMobileIOS", targets: ["RyperOSMobileIOS"])
    ],
    targets: [
        .target(
            name: "RyperOSMobileIOS",
            path: "Sources/RyperOSMobileIOS"
        )
    ]
)
