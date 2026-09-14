#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

static const uint32_t kMaximumFrameBytes = 1024 * 1024;

@interface NSApplication (ChromiumSpeechSelectors)
- (void)speakString:(NSString *)string;
- (void)stopSpeaking:(id)sender;
- (BOOL)isSpeaking;
@end

static BOOL SpeechRouteAvailable(void) {
  return [NSApp respondsToSelector:@selector(speakString:)] &&
         [NSApp respondsToSelector:@selector(stopSpeaking:)] &&
         [NSApp respondsToSelector:@selector(isSpeaking)];
}

static NSData *ReadExactly(NSFileHandle *handle, NSUInteger count) {
  NSMutableData *result = [NSMutableData dataWithCapacity:count];
  while (result.length < count) {
    NSData *chunk = [handle readDataOfLength:count - result.length];
    if (chunk.length == 0) return result.length == 0 ? nil : result;
    [result appendData:chunk];
  }
  return result;
}

@interface AgentDelegate : NSObject <NSApplicationDelegate>
@property(nonatomic, strong) NSFileHandle *input;
@property(nonatomic, strong) NSFileHandle *output;
@property(nonatomic, copy) NSString *activeId;
@property(nonatomic, strong) NSTimer *speechTimer;
@property(nonatomic, strong) NSDate *startDeadline;
@property(nonatomic) BOOL observedSpeaking;
@property(nonatomic) BOOL startedEmitted;
@end

@implementation AgentDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  NSArray<NSString *> *arguments = NSProcessInfo.processInfo.arguments;
  if (arguments.count < 3) { [NSApp terminate:nil]; return; }
  self.input = [NSFileHandle fileHandleForReadingAtPath:arguments[arguments.count - 2]];
  self.output = [NSFileHandle fileHandleForWritingAtPath:arguments.lastObject];
  if (!self.input || !self.output) { [NSApp terminate:nil]; return; }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
    [self readRequests];
  });
}

- (void)readRequests {
  @autoreleasepool {
    while (YES) {
      NSData *header = ReadExactly(self.input, 4);
      if (!header || header.length != 4) break;
      uint32_t length = 0;
      [header getBytes:&length length:4];
      length = CFSwapInt32LittleToHost(length);
      if (length == 0 || length > kMaximumFrameBytes) break;
      NSData *payload = ReadExactly(self.input, length);
      if (!payload || payload.length != length) break;
      NSError *error = nil;
      id value = [NSJSONSerialization JSONObjectWithData:payload options:0 error:&error];
      dispatch_async(dispatch_get_main_queue(), ^{
        if (error || ![value isKindOfClass:NSDictionary.class]) {
          [self send:@{ @"type": @"error", @"id": @"protocol",
                        @"error": @"invalid_request", @"message": @"Invalid JSON request." }];
        } else {
          [self handle:(NSDictionary *)value];
        }
      });
    }
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopActiveWithType:nil];
    [self.output closeFile];
    [NSApp terminate:nil];
  });
}

- (void)handle:(NSDictionary *)request {
  NSString *requestId = [request[@"id"] isKindOfClass:NSString.class] ? request[@"id"] : nil;
  NSString *action = [request[@"action"] isKindOfClass:NSString.class] ? request[@"action"] : nil;
  if (!requestId.length || [requestId lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 128 ||
      !action.length || [action lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 64) {
    [self fail:requestId ?: @"protocol" code:@"invalid_request"
       message:@"Requests require bounded non-empty string id and action fields."];
    return;
  }
  if ([action isEqualToString:@"capabilities"]) {
    BOOL supported = SpeechRouteAvailable();
    [self send:@{ @"type": @"capabilities", @"id": requestId,
                  @"mode": @"system-speech", @"available": @(supported),
                  @"canStop": @(supported), @"canPause": @NO, @"canSeek": @NO,
                  @"hasPcm": @NO }];
  } else if ([action isEqualToString:@"listVoices"]) {
    BOOL supported = SpeechRouteAvailable();
    [self send:@{ @"type": @"voices", @"id": requestId,
                  @"voices": @[ @{ @"id": @"macos-start-speaking",
                                    @"name": @"Mac voice (Start Speaking)",
                                    @"available": @(supported) } ] }];
  } else if ([action isEqualToString:@"speak"]) {
    [self speak:request requestId:requestId];
  } else if ([action isEqualToString:@"stop"]) {
    if (![self.activeId isEqualToString:requestId]) {
      [self fail:requestId code:@"not_active" message:@"That speech request is not active."];
    } else {
      [self stopActiveWithType:@"cancelled"];
    }
  } else {
    [self fail:requestId code:@"unsupported_action"
       message:[NSString stringWithFormat:@"Unsupported action: %@", action]];
  }
}

- (void)speak:(NSDictionary *)request requestId:(NSString *)requestId {
  NSString *text = [request[@"text"] isKindOfClass:NSString.class] ? request[@"text"] : nil;
  NSString *trimmed = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!trimmed.length) { [self fail:requestId code:@"invalid_text" message:@"Speak requires non-empty text."]; return; }
  if ([text lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > 900000) {
    [self fail:requestId code:@"text_too_large" message:@"Text exceeds 900,000 bytes."]; return;
  }
  if (!SpeechRouteAvailable()) {
    [self fail:requestId code:@"unavailable" message:@"AppKit Start Speaking is unavailable."]; return;
  }
  [self stopActiveWithType:@"cancelled"];
  self.activeId = requestId;
  self.observedSpeaking = NO;
  self.startedEmitted = NO;
  self.startDeadline = [NSDate dateWithTimeIntervalSinceNow:3.0];
  [NSApp speakString:text];
  self.speechTimer = [NSTimer scheduledTimerWithTimeInterval:0.05 target:self
                                                    selector:@selector(pollSpeech:)
                                                    userInfo:nil repeats:YES];
}

- (void)pollSpeech:(NSTimer *)timer {
  (void)timer;
  if (!self.activeId) return;
  BOOL speaking = [NSApp isSpeaking];
  self.observedSpeaking |= speaking;
  if (speaking && !self.startedEmitted) {
    self.startedEmitted = YES;
    [self send:@{ @"type": @"started", @"id": self.activeId }];
  }
  if (self.observedSpeaking && !speaking) {
    NSString *endedId = self.activeId;
    [self clearActive];
    [self send:@{ @"type": @"ended", @"id": endedId }];
  } else if (!self.observedSpeaking && [self.startDeadline timeIntervalSinceNow] <= 0) {
    NSString *failedId = self.activeId;
    [self clearActive];
    [self fail:failedId code:@"start_failed" message:@"AppKit did not start speaking."];
  }
}

- (void)stopActiveWithType:(NSString *)type {
  if (!self.activeId) return;
  NSString *stoppedId = self.activeId;
  if ([NSApp respondsToSelector:@selector(stopSpeaking:)]) [NSApp stopSpeaking:nil];
  [self clearActive];
  if (type) [self send:@{ @"type": type, @"id": stoppedId }];
}

- (void)clearActive {
  [self.speechTimer invalidate];
  self.speechTimer = nil;
  self.activeId = nil;
  self.observedSpeaking = NO;
  self.startedEmitted = NO;
  self.startDeadline = nil;
}

- (void)fail:(NSString *)requestId code:(NSString *)code message:(NSString *)message {
  [self send:@{ @"type": @"error", @"id": requestId,
                @"error": code, @"message": message }];
}

- (void)send:(NSDictionary *)object {
  NSError *error = nil;
  NSData *payload = [NSJSONSerialization dataWithJSONObject:object options:0 error:&error];
  if (error || payload.length >= 256 * 1024) return;
  uint32_t length = CFSwapInt32HostToLittle((uint32_t)payload.length);
  NSMutableData *frame = [NSMutableData dataWithBytes:&length length:4];
  [frame appendData:payload];
  @try { [self.output writeData:frame]; }
  @catch (NSException *exception) { [NSApp terminate:nil]; }
}
@end

int main(int argc, const char *argv[]) {
  (void)argc; (void)argv;
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    [app setActivationPolicy:NSApplicationActivationPolicyProhibited];
    AgentDelegate *delegate = [[AgentDelegate alloc] init];
    app.delegate = delegate;
    [app run];
  }
  return 0;
}
