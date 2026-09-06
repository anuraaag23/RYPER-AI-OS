// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "RyperOSDesktopMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "RyperOSDesktopMac", targets: ["RyperOSDesktopMac"])
    ],
    targets: [
        .executableTarget(
            name: "RyperOSDesktopMac",
            path: "Sources/RyperOSDesktopMac"
        )
    ]
)
