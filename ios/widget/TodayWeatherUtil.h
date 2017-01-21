//
//  TodayWeatherUtil.h
//  TodayWeather
//
//  Created by KwangHo Kim on 2016. 11. 20..
//
//

#ifndef TodayWeatherUtil_h
#define TodayWeatherUtil_h

/********************************************************************
 Declare include files
 ********************************************************************/
#import <Foundation/Foundation.h>

/********************************************************************
 Declare Class Definitions
 ********************************************************************/
@interface TodayWeatherUtil : NSObject
{
    
}

/********************************************************************
 Declare Class properties
 ********************************************************************/


/********************************************************************
 Declare Class functions
 ********************************************************************/
+ (int) getYYYYMMDDFromUTCTime:(unsigned int)UTCTime;
+ (long long) makeIntTimeWithDate:(NSString*)nssDate time:(NSString *)nssTime;
+ (NSDate *) makeNSDateWithDate:(NSString*)nssDate time:(NSString *)nssTime;
+ (NSDate *) getYesterday;
+ (NSArray *) getDaysArray:(NSDictionary *)jsonDict;
+ (NSMutableArray *) getByTimeArray:(NSDictionary *)jsonDict;
+ (NSMutableDictionary *) getTodayDictionary:(NSDictionary *)jsonDict;
@end

#endif /* TodayWeatherUtil_h */
