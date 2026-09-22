import Darwin
import Foundation

private let maximumFrameBytes = 1_048_576

private func readExactly(_ count: Int, from input: FileHandle) throws -> Data? {
    var result = Data()
    while result.count < count {
        guard let chunk = try input.read(upToCount: count - result.count), !chunk.isEmpty else {
            return result.isEmpty ? nil : result
        }
        result.append(chunk)
    }
    return result
}

private func copyFrames(from input: FileHandle, to output: FileHandle,
                        onFirstFrame: (() -> Void)? = nil,
                        transform: ((Data) throws -> Data?)? = nil) throws {
    var first = true
    while let header = try readExactly(4, from: input) {
        guard header.count == 4 else { throw NSError(domain: "LocalReader", code: 1) }
        let length = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self).littleEndian }
        guard length > 0, length <= maximumFrameBytes else { throw NSError(domain: "LocalReader", code: 2) }
        guard let body = try readExactly(Int(length), from: input), body.count == Int(length) else {
            throw NSError(domain: "LocalReader", code: 3)
        }
        if first { first = false; onFirstFrame?() }
        if let forwarded = try transform?(body) ?? (transform == nil ? body : nil) {
            try writeFrame(forwarded, to: output)
        }
    }
}

private let requestWriteLock = NSLock()
private func writeFrame(_ body: Data, to output: FileHandle) throws {
    var size = UInt32(body.count).littleEndian
    var frame = withUnsafeBytes(of: &size) { Data($0) }
    frame.append(body)
    requestWriteLock.lock()
    defer { requestWriteLock.unlock() }
    try output.write(contentsOf: frame)
}

// Register before permitting exit: launcher exit or FIFO EOF does not prove that
// the LaunchServices-owned speech process exited. NOTE_EXIT tracks this process.
private func verifyShutdown(_ value: [String: Any], requestOutput: FileHandle) throws -> Data {
    guard let id = value["id"] as? String, value["stopped"] as? Bool == true,
          let pid = value["pid"] as? Int32, pid > 1 else {
        throw NSError(domain: "LocalReader.shutdown", code: 1)
    }
    let queue = kqueue()
    guard queue >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
    defer { Darwin.close(queue) }
    var change = kevent(ident: UInt(pid), filter: Int16(EVFILT_PROC),
                        flags: UInt16(EV_ADD | EV_ONESHOT), fflags: UInt32(NOTE_EXIT), data: 0, udata: nil)
    guard kevent(queue, &change, 1, nil, 0, nil) == 0 else {
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
    try writeFrame(JSONSerialization.data(withJSONObject: ["action": "_exit", "id": id]), to: requestOutput)
    var event = kevent()
    var timeout = timespec(tv_sec: 3, tv_nsec: 0)
    guard kevent(queue, nil, 0, &event, 1, &timeout) == 1,
          event.ident == UInt(pid), event.filter == Int16(EVFILT_PROC),
          event.fflags & UInt32(NOTE_EXIT) != 0, event.flags & UInt16(EV_ERROR) == 0 else {
        throw NSError(domain: "LocalReader.shutdown", code: 2)
    }
    return try JSONSerialization.data(withJSONObject: ["type": "shutdown-complete", "id": id,
        "stopped": true, "processExited": true, "pid": pid])
}

private func openWriter(_ path: String, timeout: TimeInterval) throws -> Int32 {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        let fd = Darwin.open(path, O_WRONLY | O_NONBLOCK)
        if fd >= 0 { _ = fcntl(fd, F_SETFL, 0); return fd }
        if errno != ENXIO && errno != ENOENT { break }
        usleep(50_000)
    }
    throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
}

let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let appURL = executable.deletingLastPathComponent().appendingPathComponent("StartSpeakingAgent.app")
let ipcDirectory = FileManager.default.temporaryDirectory
    .appendingPathComponent("local-reader-native-\(getpid())", isDirectory: true)
try FileManager.default.createDirectory(at: ipcDirectory, withIntermediateDirectories: true,
                                        attributes: [.posixPermissions: 0o700])
defer { try? FileManager.default.removeItem(at: ipcDirectory) }
let requestPath = ipcDirectory.appendingPathComponent("requests").path
let responsePath = ipcDirectory.appendingPathComponent("responses").path
guard mkfifo(requestPath, 0o600) == 0, mkfifo(responsePath, 0o600) == 0 else {
    throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
}

let launcher = Process()
launcher.executableURL = URL(fileURLWithPath: "/usr/bin/open")
launcher.arguments = ["-n", "-W", appURL.path, "--args", requestPath, responsePath]
launcher.standardOutput = FileHandle.standardError
launcher.standardError = FileHandle.standardError
try launcher.run()

let requestFD = try openWriter(requestPath, timeout: 8)
let responseFD = Darwin.open(responsePath, O_RDONLY | O_NONBLOCK)
guard responseFD >= 0 else { launcher.terminate(); throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
// A FIFO read reports EOF if the agent has not yet opened its writer, even after
// clearing O_NONBLOCK. Hold a writer until the first response establishes that
// pairing. Also close it on Chrome EOF so cancelled startup cannot strand us.
let responseHoldFD = Darwin.open(responsePath, O_WRONLY | O_NONBLOCK)
guard responseHoldFD >= 0 else { launcher.terminate(); throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
let responseHold = FileHandle(fileDescriptor: responseHoldFD, closeOnDealloc: true)
_ = fcntl(responseFD, F_SETFL, 0)
let requestOutput = FileHandle(fileDescriptor: requestFD, closeOnDealloc: true)
let responseInput = FileHandle(fileDescriptor: responseFD, closeOnDealloc: true)

let responseDone = DispatchSemaphore(value: 0)
DispatchQueue.global(qos: .userInitiated).async {
    defer { responseDone.signal() }
    do {
        try copyFrames(from: responseInput, to: FileHandle.standardOutput,
                       onFirstFrame: { try? responseHold.close() }, transform: { body in
            let value = try JSONSerialization.jsonObject(with: body) as? [String: Any]
            guard value?["type"] as? String == "shutdown-ready", let value else { return body }
            do { return try verifyShutdown(value, requestOutput: requestOutput) }
            catch {
                return try JSONSerialization.data(withJSONObject: ["type": "error", "id": value["id"] ?? "protocol",
                    "error": "shutdown_unverified", "message": "The native speech process exit was not verified."])
            }
        })
    } catch { fputs("com.localreader.native_tts: output relay failed: \(error)\n", stderr) }
}

do {
    try copyFrames(from: FileHandle.standardInput, to: requestOutput, transform: { body in
        let value = try JSONSerialization.jsonObject(with: body) as? [String: Any]
        guard value?["action"] as? String != "_exit" else {
            throw NSError(domain: "LocalReader.protocol", code: 1)
        }
        return body
    })
}
catch { fputs("com.localreader.native_tts: input relay failed: \(error)\n", stderr) }
try? requestOutput.close()
try? responseHold.close()
_ = responseDone.wait(timeout: .now() + 5)
if launcher.isRunning { launcher.terminate() }
launcher.waitUntilExit()
