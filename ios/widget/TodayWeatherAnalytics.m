//
//  TodayWeatherGoogleAnalytics.m
//  widget
//
//  Created by KwangHo Kim on 2018. 2. 12..
//

#import <Foundation/Foundation.h>
#import "TodayWeatherAnalytics.h"



//static BOOL const kGaDryRun = NO;
//static int const kGaDispatchPeriod = 30;

@implementation TodayWeatherAnalytics

- (void) initTracker
{
     GAI *gai = [GAI sharedInstance];
    // Initialize a tracker using a Google Analytics property ID.
    [[GAI sharedInstance] trackerWithTrackingId:@"UA-70746703-3"];
    
    // Optional: automatically report uncaught exceptions.
    gai.trackUncaughtExceptions = YES;
//    [gai setDispatchInterval:kGaDispatchPeriod];
//    [gai setDryRun:kGaDryRun];
    
    [self setLogLevel:kGAILogLevelVerbose];

    id<GAITracker> tracker = [[GAI sharedInstance] defaultTracker];
    tracker.allowIDFACollection = YES;
    
    NSString *version = [[[NSBundle mainBundle] infoDictionary] objectForKey:@"CFBundleShortVersionString"];
    [tracker set:@"&av" value: version];
    //[tracker set:kGAIScreenName value:@"iOSWidget"];
}

- (void) addScreenTracking:(NSString *)nssName
{
    id<GAITracker> tracker = [GAI sharedInstance].defaultTracker;
    [tracker set:kGAIScreenName value:nssName];
    [tracker send:[[GAIDictionaryBuilder createScreenView] build]];
}

/*  kGAILogLevelNone = 0,
//  kGAILogLevelError = 1,
//  kGAILogLevelWarning = 2,
//  kGAILogLevelInfo = 3,
//  kGAILogLevelVerbose = 4 */
- (void) setLogLevel:(GAILogLevel)level
{
    [[GAI sharedInstance].logger setLogLevel:level];
}

@end
