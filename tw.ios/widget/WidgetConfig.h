//
//  WidgetConfig.h
//  TodayWeather
//
//  Created by SeanKim on 6/22/16.
//
//

#ifndef WidgetConfig_h
#define WidgetConfig_h

/********************************************************************
 Declare Definitions
 ********************************************************************/

#define DAUM_SERVICE_KEY            @"6d0116e2c49361cb75eaf12f665e6360"
#define TODAYWEATHER_URL            @"https://todayweather.wizardfactory.net"

#define UIColorFromRGB(rgbValue) [UIColor \
                                    colorWithRed:((float)((rgbValue & 0xFF0000) >> 16))/255.0 \
                                    green:((float)((rgbValue & 0xFF00) >> 8))/255.0 \
                                    blue:((float)(rgbValue & 0xFF))/255.0 alpha:1.0]

typedef enum _TYPE_REQUEST_
{
    TYPE_REQUEST_NONE,
    TYPE_REQUEST_ADDR_DAUM,
    TYPE_REQUEST_ADDR_GOOGLE,
    TYPE_REQUEST_GEO_GOOGLE,
    TYPE_REQUEST_WEATHER_KR,
    TYPE_REQUEST_WEATHER_GLOBAL,
    TYPE_REQUEST_WEATHER_BY_COORD,
    TYPE_REQUEST_MAX,
} TYPE_REQUEST;

#if DEBUG == 0
#define DebugLog(...)
#elif DEBUG == 1
//#define NSLog( s, ... ) NSLog( @"<%p %@:(%d)> %@", self, [[NSString stringWithUTF8String:__FILE__] lastPathComponent], __LINE__, [NSString stringWithFormat:(s), ##__VA_ARGS__] )
#define NSLog( s, ... ) NSLog( @"[%@:%d] %@", [[NSString stringWithUTF8String:__FILE__] lastPathComponent], __LINE__, [NSString stringWithFormat:(s), ##__VA_ARGS__] )

#define DebugLog(...) NSLog(__VA_ARGS__)
#endif

#endif /* WidgetConfig_h */
