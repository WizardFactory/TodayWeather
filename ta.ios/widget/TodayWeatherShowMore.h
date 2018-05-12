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
#import "WidgetConfig.h"

@class TodayViewController;

/********************************************************************
 Declare Class Definitions
 ********************************************************************/
@interface TodayWeatherShowMore : NSObject
{
    NSString *curCountry;
    
    NSMutableDictionary    *curAirDataDict;
}

/********************************************************************
 Declare Class properties
 ********************************************************************/
@property (retain, nonatomic) NSString *curCountry;
@property (retain, nonatomic) NSMutableDictionary    *curAirDataDict;

/********************************************************************
 Declare Class functions
 ********************************************************************/
- (void) processDailyData:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType;
- (void) processByTimeData:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType;
- (NSString *) getAirState:(NSDictionary *)currentArpltnDict;
- (NSMutableAttributedString *) getChangedColorAirState:(NSString *)nssAirState;
- (UIColor *) getColorAirState:(NSString *)nssAirState;
- (UIColor *) getColorAirStateByGrade:(unsigned int)grade rcvAirUnit:(NSString *)rcvAirUnit;

- (void) transitView:(UIView *)curView
          transition:(UIViewAnimationTransition)transiton
            duration:(NSTimeInterval)duration;
- (void) showDailyWeatherAsWidth;

- (NSString *) getCurCountry;
- (void) setCurCountry:(NSString *)nssCountry;

@end

#endif /* TodayWeatherShowMore_h */
