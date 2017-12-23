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
    NSMutableArray  *nsmaDaumKeys;
    NSDictionary *jsonUnitsDict;
}

/********************************************************************
 Declare Class properties
 ********************************************************************/
@property (retain, nonatomic) NSString *twuCountry;
@property (retain, nonatomic) NSMutableArray  *nsmaDaumKeys;
@property (retain, nonatomic) NSDictionary *jsonUnitsDict;

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
+ (NSMutableArray *) shuffleDatas:(NSMutableArray *)nsaDatas;

/********************************************************************
 Declare Instance functions
 ********************************************************************/
- (NSMutableArray *) getDaumServiceKeys;
- (void) setDaumServiceKeys:(NSString *)nssDaumKeys;
+ (UIImage *)renderImageFromView:(UIView *)view withRect:(CGRect)frame transparentInsets:(UIEdgeInsets)insets;

+ (NSMutableDictionary *) getTodayDictionaryByCoord:(NSDictionary *)jsonDict date:(NSString *)nssDate country:(NSString *)nssCountry;
- (void) setUnits:(NSString *)nssNewUnits;
- (NSDictionary *) getUnits;

@end

#endif /* TodayWeatherUtil_h */
