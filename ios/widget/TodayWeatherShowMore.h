//
//  TodayWeatherShowMore.h
//  TodayWeather
//
//  Created by KwangHo Kim on 2016. 11. 27..
//
//

#ifndef TodayWeatherShowMore_h
#define TodayWeatherShowMore_h

/********************************************************************
 Declare include files
 ********************************************************************/
#import "TodayViewController.h"

@class TodayViewController;

/********************************************************************
 Declare Class Definitions
 ********************************************************************/
@interface TodayWeatherShowMore : NSObject
{
    
}

/********************************************************************
 Declare Class properties
 ********************************************************************/


/********************************************************************
 Declare Class functions
 ********************************************************************/
- (void) processDailyData:(NSDictionary *)jsonDict;
- (void) processByTimeData:(NSDictionary *)jsonDict;
- (NSString *) getAirState:(NSDictionary *)currentArpltnDict;
- (void) transitView:(UIView *)curView
          transition:(UIViewAnimationTransition)transiton
            duration:(NSTimeInterval)duration;
@end

#endif /* TodayWeatherShowMore_h */
