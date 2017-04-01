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

typedef enum _TYPE_REQUEST_
{
    TYPE_REQUEST_NONE,
    TYPE_REQUEST_ADDR_DAUM,
    TYPE_REQUEST_ADDR_GOOGLE,
    TYPE_REQUEST_GEO_GOOGLE,
    TYPE_REQUEST_WEATHER_KR,
    TYPE_REQUEST_WEATHER_GLOBAL,
    TYPE_REQUEST_MAX,
} TYPE_REQUEST;


#endif /* WidgetConfig_h */
