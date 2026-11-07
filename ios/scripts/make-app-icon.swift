// The iPhone app icon: full bleed, as iOS wants it (iOS rounds the corners
// itself). Same design as the desktop icon (desktop/assets/icon-master.png):
// the blue background gradient, and the firm's mark filled with the desktop
// icon's white-to-cyan gradient, drawn from the high-resolution mark
// (public/images/brand/tma/tma-logo-mark.png).
//
//   swift ios/scripts/make-app-icon.swift public/images/brand/tma/tma-logo-mark.png \
//     ios/TMAPortal/Assets.xcassets/AppIcon.appiconset/AppIcon.png 0.74
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let size = 1024
let fraction = args.count > 3 ? Double(args[3])! : 0.74
let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ hex: UInt32) -> CGColor {
    CGColor(colorSpace: space, components: [CGFloat((hex >> 16) & 0xFF) / 255, CGFloat((hex >> 8) & 0xFF) / 255, CGFloat(hex & 0xFF) / 255, 1])!
}
func gradient(_ top: UInt32, _ bottom: UInt32) -> CGGradient {
    CGGradient(colorsSpace: space, colors: [rgb(top), rgb(bottom)] as CFArray, locations: [0, 1])!
}

let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil)!
let mark = CGImageSourceCreateImageAtIndex(src, 0, nil)!

// The mark, recoloured: its alpha, filled with the desktop icon's mark gradient.
let side = CGFloat(size) * CGFloat(fraction)
let markRect = CGRect(x: (CGFloat(size) - side) / 2, y: (CGFloat(size) - side) / 2, width: side, height: side)
let layer = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
layer.interpolationQuality = .high
layer.draw(mark, in: markRect)
layer.setBlendMode(.sourceIn)
// Core Graphics' y runs upward: the gradient starts at the top edge of the mark.
layer.drawLinearGradient(gradient(0xEDF9FF, 0x3BC5FF), start: CGPoint(x: 0, y: markRect.maxY), end: CGPoint(x: 0, y: markRect.minY), options: [])
let recoloured = layer.makeImage()!

// Full-bleed background, then the mark. No alpha: the App Store refuses an icon with one.
let out = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
out.drawLinearGradient(gradient(0x0E93D0, 0x1777A8), start: CGPoint(x: 0, y: size), end: CGPoint(x: 0, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
out.draw(recoloured, in: CGRect(x: 0, y: 0, width: size, height: size))

let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, out.makeImage()!, nil)
CGImageDestinationFinalize(dest)
print("wrote \(size)x\(size), mark at \(Int(fraction * 100))% width")
