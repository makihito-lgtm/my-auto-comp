import Foundation
import Vision
import AppKit

// 引数チェック
let arguments = CommandLine.arguments
let isConcentrationMode = arguments.contains("--concentration")

// クロップ範囲の取得 (--crop x,y,w,h)
var cropRect: CGRect? = nil
if let cropIndex = arguments.firstIndex(of: "--crop"), cropIndex + 1 < arguments.count {
    let coords = arguments[cropIndex + 1].components(separatedBy: ",")
    if coords.count == 4,
       let x = Double(coords[0]), let y = Double(coords[1]),
       let w = Double(coords[2]), let h = Double(coords[3]) {
        cropRect = CGRect(x: x, y: y, width: w, height: h)
    }
}

func performOCR() {
    let tempPath = NSTemporaryDirectory() + "screen.png"
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    
    if let rect = cropRect {
        task.arguments = ["-x", "-R", "\(Int(rect.origin.x)),\(Int(rect.origin.y)),\(Int(rect.size.width)),\(Int(rect.size.height))", tempPath]
    } else {
        task.arguments = ["-x", tempPath]
    }
    
    do {
        try task.run()
        task.waitUntilExit()
    } catch { return }

    let imageURL = URL(fileURLWithPath: tempPath)
    let requestHandler = VNImageRequestHandler(url: imageURL, options: [:])
    
    let request = VNRecognizeTextRequest { (request, error) in
        guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
        
        // --- 視覚的な順序（上から下）でソート ---
        let sortedObservations = observations.sorted { (obs1, obs2) -> Bool in
            return obs1.boundingBox.origin.y > obs2.boundingBox.origin.y
        }
        
        var results: [[String: Any]] = []
        
        for observation in sortedObservations {
            let topCandidates = observation.topCandidates(1)
            if let recognizedText = topCandidates.first {
                let text = recognizedText.string.trimmingCharacters(in: .whitespacesAndNewlines)
                if text.count < 2 { continue }

                let bbox = observation.boundingBox
                if let rect = cropRect {
                    let vx = bbox.origin.x * rect.width
                    let vy = (1.0 - bbox.origin.y - bbox.height) * rect.height
                    let vw = bbox.width * rect.width
                    let vh = bbox.height * rect.height
                    
                    results.append([
                        "text": text,
                        "x": Int(vx),
                        "y": Int(vy),
                        "width": Int(vw),
                        "height": Int(vh)
                    ])
                }
            }
        }
        
        let output: [String: Any] = ["results": results]
        if let jsonData = try? JSONSerialization.data(withJSONObject: output, options: []),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        }
    }

    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP", "en-US"]
    request.usesLanguageCorrection = true

    do {
        try requestHandler.perform([request])
    } catch { }
    
    try? FileManager.default.removeItem(atPath: tempPath)
}

performOCR()
