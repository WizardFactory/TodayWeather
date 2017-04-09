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
#import "TodayViewController.h"

typedef enum _TEMP_UNIT_ {
    TEMP_UNIT_CELSIUS,
    TEMP_UNIT_FAHRENHEIT,
} TEMP_UNIT;

extern TEMP_UNIT    gTemperatureUnit;

/********************************************************************
 Declare Class Definitions
 ********************************************************************/
@interface TodayWeatherUtil : NSObject
{
//    NSString *twuCountry;

}

/********************************************************************
 Declare Class properties
 ********************************************************************/
@property (retain, nonatomic) NSString *twuCountry;
//@property (retain, nonatomic) TEMP_UNIT    temperatureUnit;

/********************************************************************
 Declare Class functions
 ********************************************************************/
+ (int) getYYYYMMDDFromUTCTime:(unsigned int)UTCTime;
+ (long long) makeIntTimeWithDate:(NSString*)nssDate time:(NSString *)nssTime;
+ (NSDate *) makeNSDateWithDate:(NSString*)nssDate time:(NSString *)nssTime;
+ (NSDate *) getYesterday;
+ (NSArray *) getDaysArray:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType;
+ (NSMutableArray *) getByTimeArray:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType;
+ (NSMutableDictionary *) getTodayDictionary:(NSDictionary *)jsonDict;
+ (NSMutableDictionary *) getTodayDictionaryInGlobal:(NSDictionary *)jsonDict time:(NSString *)nssTime;
+ (TEMP_UNIT) getTemperatureUnit;
+ (void) setTemperatureUnit:(NSString *)nssUnits;
+ (NSString *) processLocationStr:(NSString *)nssSrcStr;
+ (float) convertFromCelsToFahr:(float)cels;
//+ (void) processKRAddress;
@end

#endif /* TodayWeatherUtil_h */
