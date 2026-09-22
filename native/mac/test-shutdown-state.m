// Deterministic speech-state tests. Replaces NSApp; never invokes real speech.
#define main LocalReaderAgentMain
#import "StartSpeakingAgent.m"
#undef main

@interface FakeSpeechApplication : NSObject
@property BOOL speaking;
@property BOOL terminated;
@property NSUInteger stopCalls;
@property NSUInteger speakCalls;
@end
@implementation FakeSpeechApplication
- (void)speakString:(NSString *)text { (void)text; self.speakCalls++; }
- (void)stopSpeaking:(id)sender { (void)sender; self.stopCalls++; }
- (BOOL)isSpeaking { return self.speaking; }
- (void)terminate:(id)sender { (void)sender; self.terminated = YES; }
@end
@interface ProbeDelegate : AgentDelegate
@property NSMutableArray *messages;
@end
@implementation ProbeDelegate
- (instancetype)init { if ((self = [super init])) self.messages = [NSMutableArray array]; return self; }
- (void)send:(NSDictionary *)object { [self.messages addObject:object]; }
@end
static BOOL HasType(ProbeDelegate *probe, NSString *type) {
  for (NSDictionary *message in probe.messages) if ([message[@"type"] isEqual:type]) return YES;
  return NO;
}
static void Check(BOOL value, NSString *message) {
  if (!value) { fprintf(stderr, "FAIL: %s\n", message.UTF8String); exit(1); }
}
int main(void) {
  @autoreleasepool {
    FakeSpeechApplication *fake = [FakeSpeechApplication new];
    NSApp = (NSApplication *)fake;
    ProbeDelegate *early = [ProbeDelegate new];
    [early handle:@{ @"action": @"speak", @"id": @"early", @"text": @"Injected fake speech" }];
    [early handle:@{ @"action": @"shutdown", @"id": @"close-early" }];
    Check(!HasType(early, @"shutdown-ready"), @"False before delayed startup is not stopped proof");
    Check(early.activeId != nil, @"Delayed startup retains ownership");
    fake.speaking = YES;
    early.stopNotBefore = [NSDate dateWithTimeIntervalSinceNow:-1];
    [early pollStop];
    Check(!HasType(early, @"shutdown-ready"), @"Speaking after stop request blocks shutdown acknowledgement");
    [early handle:@{ @"action": @"speak", @"id": @"replacement", @"text": @"must not start" }];
    Check(fake.speakCalls == 1, @"Shutdown rejects overlapping replacement");
    fake.speaking = NO;
    [early pollStop];
    Check(HasType(early, @"shutdown-ready") && HasType(early, @"cancelled"), @"Observed stopped completes only old speech");
    Check(!fake.terminated, @"Helper awaits relay exit watcher before terminating");
    [early handle:@{ @"action": @"_exit", @"id": @"wrong" }];
    Check(!fake.terminated, @"Wrong exit id rejected");
    [early handle:@{ @"action": @"_exit", @"id": @"close-early" }];
    Check(fake.terminated, @"Matching watched exit terminates helper");

    fake.terminated = NO; fake.speaking = YES;
    ProbeDelegate *stuck = [ProbeDelegate new];
    stuck.activeId = @"stuck"; stuck.observedSpeaking = YES;
    [stuck beginStopForShutdown:@"close-stuck"];
    stuck.stopDeadline = [NSDate dateWithTimeIntervalSinceNow:-1];
    [stuck pollStop];
    Check(!HasType(stuck, @"shutdown-ready") && HasType(stuck, @"error"), @"Stuck speech times out without success");
    Check(fake.terminated, @"Failed shutdown terminates its own helper");

    fake.terminated = NO; fake.speaking = YES;
    ProbeDelegate *stop = [ProbeDelegate new];
    stop.activeId = @"stop"; stop.observedSpeaking = YES;
    [stop handle:@{ @"action": @"stop", @"id": @"stop" }];
    Check(!HasType(stop, @"cancelled"), @"Stop request receipt is not cancellation completion");
    [stop handle:@{ @"action": @"speak", @"id": @"replacement", @"text": @"must not start" }];
    Check([stop.activeId isEqual:@"stop"] && fake.speakCalls == 1, @"Stopping preserves old ownership");
    fake.speaking = NO; [stop pollStop];
    Check(HasType(stop, @"cancelled") && !stop.activeId, @"Cancellation follows stopped observation");
    printf("Passed 13 deterministic native shutdown assertions; no real speech invoked.\n");
  }
  return 0;
}
