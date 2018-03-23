//
//  TodayWeatherAnalytics.h
//  widget
//
//  Created by KwangHo Kim on 2018. 2. 12..
//

#ifndef TodayWeatherAnalytics_h
#define TodayWeatherAnalytics_h

#import "GAI.h"
#import "GAIDictionaryBuilder.h"
#import "GAIFields.h"

@interface TodayWeatherAnalytics : NSObject
{

}

- (void) initTracker;
- (void) addScreenTracking:(NSString *)nssName;
- (void) setLogLevel:(GAILogLevel)level;

@end

#endif /* TodayWeatherGoogleAnalytics_h */


