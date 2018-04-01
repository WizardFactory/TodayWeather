//
//  TodayWeatherShowMore.m
//  TodayWeather
//
//  Created by KwangHo Kim on 2016. 11. 27..
//
//

#import <Foundation/Foundation.h>
#import "TodayWeatherShowMore.h"
#import "TodayWeatherUtil.h"
//#import "TodayViewController.h"
#import "CoreText/CoreText.h"
#import "LocalizationDefine.h"

#define FIVE_DAILY_WT_WMARGIN   2           // Sum of LR Margin 4
#define FIVE_DAILY_WT_WIDTH     60

#define FIVE_DAILY_IMG_MARGIN    12
#define FIVE_DAILY_IMG_WIDTH     36
#define FIVE_DAILY_IMG_HEIGHT    36

@implementation TodayWeatherShowMore
@synthesize curCountry;

/********************************************************************
 *
 * Name			: processDailyData
 * Description	: process daily data and draw
 * Returns		: void
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (void) processDailyData:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType;
{
    NSArray         *arrDaysData = nil;
    int             taMax = 0;
    int             taMin = 0;
    NSString        *nssTempMaxMin = nil;
    
    NSString        *nssMonth = nil;
    NSString        *nssDay = nil;
    NSString        *nssDate = nil;
    
    NSString        *nssSkyIcon = nil;
    TEMP_UNIT       tempUnit = TEMP_UNIT_CELSIUS;
    NSString        *nssCountry = nil;
    
    NSLog(@"[proDailyData] reqType : %d", reqType);
    
    TodayViewController *TVC = [TodayViewController sharedInstance];

    arrDaysData         = [TodayWeatherUtil getDaysArray:jsonDict type:reqType];
    
    nssCountry          = [self getCurCountry];
    tempUnit            = [TodayWeatherUtil getTemperatureUnit];
    
    NSLog(@"[proDailyData] country : %@", nssCountry);
    
    for(int i = 0 ; i < [arrDaysData count]; i++)
    {
        if(reqType == TYPE_REQUEST_WEATHER_KR)
        {
            nssDate             = [[arrDaysData objectAtIndex:i] objectForKey:@"date"];
            nssMonth            = [nssDate substringWithRange:NSMakeRange(4, 2)];
            nssDay              = [nssDate substringFromIndex:6];
            
            taMin               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tmn"] intValue];
            taMax               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tmx"] intValue];
            
//            if(tempUnit == TEMP_UNIT_FAHRENHEIT)
//            {
//                taMin = [TodayWeatherUtil convertFromCelsToFahr:taMin];
//                taMax = [TodayWeatherUtil convertFromCelsToFahr:taMax];
//            }
        }
        else if (reqType == TYPE_REQUEST_WEATHER_GLOBAL)
        {
            nssDate             = [[arrDaysData objectAtIndex:i] objectForKey:@"date"];
            nssMonth            = [nssDate substringWithRange:NSMakeRange(4, 2)];
            nssDay              = [nssDate substringFromIndex:6];
            taMin               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tmn"] intValue];
            taMax               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tmx"] intValue];
            
//            nssDate             = [[arrDaysData objectAtIndex:i] objectForKey:@"date"];
//            nssMonth            = [nssDate substringWithRange:NSMakeRange(5, 2)];
//            nssDay              = [nssDate substringWithRange:NSMakeRange(8, 2)];
//
//            if(tempUnit == TEMP_UNIT_CELSIUS)
//            {
//                taMin               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tempMin_c"] intValue];
//                taMax               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tempMax_c"] intValue];
//            }
//            else
//            {
//                taMin               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tempMin_f"] intValue];
//                taMax               = [[[arrDaysData objectAtIndex:i] objectForKey:@"tempMax_f"] intValue];
//            }
        }
        
        nssTempMaxMin       = [NSString stringWithFormat:@"%d˚/%d˚", taMin, taMax];
        
        nssSkyIcon          = [[arrDaysData objectAtIndex:i] objectForKey:@"skyIcon"];
        NSLog(@"[proDailyData] nssTempMaxMin : %@", nssTempMaxMin);
        
        dispatch_async(dispatch_get_main_queue(), ^{
            switch (i) {
                case 0:
                {
                    TVC->time1Label.text = LSTR_YESTERDAY;//[NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp1Label.text = nssTempMaxMin;
                    
                    TVC->showMore1IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore1IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore1IV withRect:TVC->showMore1IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                    
                case 1:
                {
                    TVC->time2Label.text = LSTR_TODAY;//[NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp2Label.text = nssTempMaxMin;
                    TVC->showMore2IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore2IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore2IV withRect:TVC->showMore2IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                    
                case 2:
                {
                    TVC->time3Label.text = LSTR_TOMORROW;
                    TVC->temp3Label.text = nssTempMaxMin;
                    
                    TVC->showMore3IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore3IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore3IV withRect:TVC->showMore3IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                case 3:
                {
                    TVC->time4Label.text = [NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp4Label.text = nssTempMaxMin;
                    
                    TVC->showMore4IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore4IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore4IV withRect:TVC->showMore4IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                case 4:
                {
                    TVC->time5Label.text = [NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp5Label.text = nssTempMaxMin;
                    TVC->showMore5IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore5IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore5IV withRect:TVC->showMore5IV.bounds transparentInsets:UIEdgeInsetsZero];

                }
                    break;
                case 5:
                {
                    TVC->time6Label.text = [NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp6Label.text = nssTempMaxMin;
                    TVC->showMore6IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore6IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore6IV withRect:TVC->showMore6IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                    
                default:
                    break;
            }
        });
    }
}

/********************************************************************
 *
 * Name			: processByTimeData
 * Description	: process data by time and draw
 * Returns		: void
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (void) processByTimeData:(NSMutableDictionary *)dict type:(TYPE_REQUEST)reqType;
{
    NSArray     *arrTimeData = nil;
    NSString    *nssSkyIcon = nil;
    NSString    *nssTime = nil;
    NSString    *nssHour = nil;
    
    NSString    *nssTempByTime = nil;
    //TEMP_UNIT tempUnit            = [TodayWeatherUtil getTemperatureUnit];
    TodayViewController *TVC = [TodayViewController sharedInstance];
    
    NSLog(@"[proByTimeData] reqType : %d", reqType);
    //NSLog(@"[processByTimeData] dict : %@", dict);
    arrTimeData = [TodayWeatherUtil getByTimeArray:dict type:reqType];
    NSLog(@"[proByTimeData] arrTimeData count : %lu", (unsigned long)[arrTimeData count]);
    
    for(int i = 0 ; i < [arrTimeData count]; i++)
    {
        //NSLog(@"[processByTimeData] i : %d", i);
        int       temperature     = 0;

//        '시'가 아니라 다국어 지원이 필요함
//        if(reqType == TYPE_REQUEST_WEATHER_KR) {
//            int       time = 0;
//            time         = [[[arrTimeData objectAtIndex:i] objectForKey:@"time"] intValue];
//            nssHour      = [NSString stringWithFormat:@"%d시", time];
//        }
//        else {
            nssTime         = [[arrTimeData objectAtIndex:i] objectForKey:@"dateObj"];
            nssHour         = [nssTime substringWithRange:NSMakeRange(11, 5)];
//        }
        
        temperature     = [[[arrTimeData objectAtIndex:i] objectForKey:@"t3h"] intValue];
        nssTempByTime       = [NSString stringWithFormat:@"%d˚", (int)temperature];
        nssSkyIcon          = [[arrTimeData objectAtIndex:i] objectForKey:@"skyIcon"];
        
        NSLog(@"nssTempMaxMin : %@", nssTempByTime);
        
        dispatch_async(dispatch_get_main_queue(), ^{
            switch (i) {
                case 0:
                {
                    TVC->time1Label.text    = [NSString stringWithFormat:@"%@", nssHour];
                    TVC->temp1Label.text    = nssTempByTime;
                    TVC->showMore1IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore1IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore1IV withRect:TVC->showMore1IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                case 1:
                {
                    TVC->time2Label.text = [NSString stringWithFormat:@"%@", nssHour];
                    TVC->temp2Label.text = nssTempByTime;
                    TVC->showMore2IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore2IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore2IV withRect:TVC->showMore2IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                case 2:
                {
                    TVC->time3Label.text = [NSString stringWithFormat:@"%@", nssHour];
                    TVC->temp3Label.text = nssTempByTime;
                    TVC->showMore3IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore3IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore3IV withRect:TVC->showMore3IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                case 3:
                {
                    TVC->time4Label.text = [NSString stringWithFormat:@"%@", nssHour];
                    TVC->temp4Label.text = nssTempByTime;
                    TVC->showMore4IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore4IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore4IV withRect:TVC->showMore4IV.bounds transparentInsets:UIEdgeInsetsZero];

                }
                    break;
                case 4:
                {
                    TVC->time5Label.text = [NSString stringWithFormat:@"%@", nssHour];
                    TVC->temp5Label.text = nssTempByTime;
                    TVC->showMore5IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore5IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore5IV withRect:TVC->showMore5IV.bounds transparentInsets:UIEdgeInsetsZero];
                }
                    break;
                case 5:
                {
                    TVC->time6Label.text = [NSString stringWithFormat:@"%@", nssHour];
                    TVC->temp6Label.text = nssTempByTime;
                    TVC->showMore6IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    TVC->showMore6IV.image = [TodayWeatherUtil renderImageFromView:TVC->showMore6IV withRect:TVC->showMore6IV.bounds transparentInsets:UIEdgeInsetsZero];

                }
                    break;
                    
                default:
                    break;
            }
        });
    }
}

/********************************************************************
 *
 * Name			: getAirState
 * Description	: get air state
 * Returns		: NSString *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (NSString *) getAirState:(NSDictionary *)currentArpltnDict
{
    int khaiGrade          = [[currentArpltnDict objectForKey:@"khaiGrade"] intValue];  // 통합대기
    int pm10Grade          = [[currentArpltnDict objectForKey:@"pm10Grade"] intValue]; // 미세먼지
    int pm25Grade          = [[currentArpltnDict objectForKey:@"pm25Grade"] intValue];  // 초미세먼지
    
    int khaiValue          = [[currentArpltnDict objectForKey:@"khaiValue"] intValue];  // 통합대기
    int pm10Value          = [[currentArpltnDict objectForKey:@"pm10Value"] intValue]; // 미세먼지
    int pm25Value          = [[currentArpltnDict objectForKey:@"pm25Value"] intValue];  // 초미세먼지
    
    NSString *nssKhaiStr          = [currentArpltnDict objectForKey:@"khaiStr"];  // 통합대기
    NSString *nssPm10Str          = [currentArpltnDict objectForKey:@"pm10Str"];  // 미세먼지
    NSString *nssPm25Str          = [currentArpltnDict objectForKey:@"pm25Str"];  // 초미세먼지
    
    NSString *nssResults        = nil;
    
    //NSLog(@"All air state is same!!! khaiGrade(%d), pm10Grade(%d), pm25Grade(%d)", khaiGrade, pm10Grade, pm25Grade);
    

    // Grade가 동일하면 통합대기 값을 전달, 동일할때 우선순위 통합대기 > 미세먼지 > 초미세먼지
    if( (khaiGrade == pm10Grade) && (pm10Grade == pm25Grade) )
    {
        if( (khaiGrade == 0) && (pm10Grade == 0) && (pm25Grade == 0) )
        {
            NSLog(@"All air state is zero !!!");
        }
        else
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_AQI, khaiValue, nssKhaiStr];
        }
    }
    else
    {
        if( (khaiGrade > pm10Grade) && (khaiGrade > pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_AQI, khaiValue, nssKhaiStr];
        }
        else if ( (khaiGrade == pm10Grade) && (khaiGrade > pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_AQI, khaiValue, nssKhaiStr];
        }
        else if ( (khaiGrade < pm10Grade) && (khaiGrade > pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM10, pm10Value, nssPm10Str];
        }
        else if ( (khaiGrade > pm10Grade) && (khaiGrade == pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_AQI, khaiValue, nssKhaiStr];
        }
        else if ( (khaiGrade < pm10Grade) && (khaiGrade == pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM10, pm10Value, nssPm10Str];
        }
        else if ( (khaiGrade > pm10Grade) && (khaiGrade < pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM25, pm25Value, nssPm25Str];
        }
        else if ( (khaiGrade == pm10Grade) && (khaiGrade < pm25Grade) )
        {
            return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM25, pm25Value, nssPm25Str];
        }
        else if ( (khaiGrade < pm10Grade) && (khaiGrade < pm25Grade) )
        {
            if ( pm10Grade > pm25Grade)
            {
                return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM10, pm10Value, nssPm10Str];
            }
            else if ( pm10Grade == pm25Grade)
            {
                return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM10, pm10Value, nssPm10Str];
            }
            else if ( pm10Grade < pm25Grade)
            {
                return [NSString stringWithFormat:@"%@ %d %@", LSTR_PM25, pm25Value, nssPm25Str];
            }
        }
    }

    if( (nssKhaiStr == nil)|| [nssKhaiStr isEqualToString:@"(null)"])
    {
        nssResults = @"";
    }
    else
    {
        nssResults = [NSString stringWithFormat:@"%@ %d %@", LSTR_AQI, khaiValue, nssKhaiStr];
    }
        
    return nssResults;
}

/********************************************************************
 *
 * Name			: getChangedColorAirState
 * Description	: get changed color air state string
 * Returns		: NSMutableAttributedString *
 * Side effects :
 * Date			: 2017. 04. 23
 * Author		: SeanKim
 * History		: 20170423 SeanKim Create function
 * Grade4       : "color": ['#32a1ff', '#00c73c', '#fd9b5a', '#ff5959']
 *  좋음 : 파랑
 *  보통 : 녹색
 *  민감군주의 : 주황
 *  나쁨 : 주황
 *  매우나쁨 : 빨강
 *  위험 : 빨강
 * Grade 6      : "color": ['#00c73c', '#d2d211', '#ff6f00', '#FF0000', '#b4004b', '#940021']
 *  좋음 : 녹색
 *  보통 : 노랑
 *  민감군주의 : 주황
 *  나쁨 : 빨강
 *  매우나쁨 : 보라
 *  위험 : 갈색
 ********************************************************************/
- (NSMutableAttributedString *) getChangedColorAirState:(NSString *)nssAirState
{
    NSMutableAttributedString *String = [[NSMutableAttributedString alloc] initWithString:nssAirState];    //AttributeString으로
    NSRange sRange;
    UIColor *stateColor = nil;
    UIFont *font = [UIFont boldSystemFontOfSize:17.0];
    BOOL isGrade6 = FALSE;
    
    TodayWeatherUtil *todayUtil = [[TodayWeatherUtil alloc] init];
    NSDictionary *nssUnits = [todayUtil getUnits];
    NSString *nssAirUnits = [nssUnits objectForKey:@"airUnit"];
    NSLog(@"[ByCoord] nssAirUnits: %@", nssAirUnits);
    
    if( [nssAirUnits isEqualToString:@"airnow"] || [nssAirUnits isEqualToString:@"aqicn"] )
        isGrade6       = TRUE;
        
    if([nssAirState hasSuffix:@"좋음"])
    {
        sRange = [nssAirState rangeOfString:@"좋음"];     //원하는 텍스트라는 글자의 위치가져오기
        if(isGrade6 == TRUE)
            stateColor = UIColorFromRGB(0x339933);           // 기존녹색
            //stateColor = UIColorFromRGB(0x00c73c);           // 녹색
        else
            stateColor = UIColorFromRGB(0x32a1ff);           // 파랑
    }
    else if([nssAirState hasSuffix:@"보통"])
    {
        sRange = [nssAirState rangeOfString:@"보통"];        //원하는 텍스트라는 글자의 위치가져오기
        if(isGrade6 == TRUE)
            stateColor = UIColorFromRGB(0xffff33);              // 기존노랑
            //stateColor = UIColorFromRGB(0xd2d211);              // 노랑
        else
            stateColor = UIColorFromRGB(0x339933);              // 녹색
    }
    else if([nssAirState hasSuffix:@"민감군주의"])
    {
        sRange = [nssAirState rangeOfString:@"민감군주의"];      //원하는 텍스트라는 글자의 위치가져오기
        if(isGrade6 == TRUE)
            stateColor = UIColorFromRGB(0xfd934c);                // 기존주황
            //stateColor = UIColorFromRGB(0xff6f00);                // 주황
        else
            stateColor = UIColorFromRGB(0xfd934c);                // 주황 나쁨과 동일
    }
    else if([nssAirState hasSuffix:@"매우나쁨"])
    {
        sRange = [nssAirState rangeOfString:@"매우나쁨"];     //원하는 텍스트라는 글자의 위치가져오기
        if(isGrade6 == TRUE)
            stateColor = UIColorFromRGB(0x540099);              // 기존보라
            //stateColor = UIColorFromRGB(0xb4004b);              // 보라
        else
            stateColor = UIColorFromRGB(0xff7070);              // 빨강
        
    }
    else if([nssAirState hasSuffix:@"나쁨"])
    {
        sRange = [nssAirState rangeOfString:@"나쁨"];     //원하는 텍스트라는 글자의 위치가져오기
        if(isGrade6 == TRUE)
            stateColor = UIColorFromRGB(0xff7070);             // 기존빨강
            //stateColor = UIColorFromRGB(0xff0000);             // 빨강
        else
            stateColor = UIColorFromRGB(0xfd934c);                // 주황 나쁨과 동일
    }
    else if([nssAirState hasSuffix:@"위험"])
    {
        sRange = [nssAirState rangeOfString:@"위험"];     //원하는 텍스트라는 글자의 위치가져오기
        if(isGrade6 == TRUE)
            stateColor = UIColorFromRGB(0x800000);           // 기존갈색
            //stateColor = UIColorFromRGB(0x940021);           // 갈색
        else
            stateColor = UIColorFromRGB(0xff7070);           // 빨강
        
        
    }
    else
    {
        sRange.location = NSNotFound;
        stateColor = [UIColor blackColor];
        
        return String;
    }
    
    NSOperatingSystemVersion nsOSVer = [[NSProcessInfo processInfo] operatingSystemVersion];
    if(nsOSVer.majorVersion >= 10)
    {
        NSLog(@"ios version is more than 10!!!");
    }
    else
    {
        NSRange sAllRange = [nssAirState rangeOfString:nssAirState];
        [String addAttribute:NSForegroundColorAttributeName value:[UIColor lightGrayColor] range:sAllRange];
    }
    
    [String addAttribute:NSForegroundColorAttributeName value:stateColor range:sRange];     //attString의 Range위치에 있는 "Nice"의 글자의
    [String addAttribute:NSFontAttributeName value:font range:sRange];     //attString의 Range위치에 있는 "Nice"의 글자의색상을 변경
    
    return String;
}



/********************************************************************
 *
 * Name			: transitView
 * Description	: transit view to any type
 * Returns		: void
 * Side effects :
 * Date			: 2017. 01. 07
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (void) transitView:(UIView *)curView
          transition:(UIViewAnimationTransition)transiton
            duration:(NSTimeInterval)duration
{
    [UIView	beginAnimations:nil context:nil];
    
    if(transiton != UIViewAnimationTransitionNone)
    {
        [UIView setAnimationDuration:duration];
    }
    
    [UIView setAnimationWillStartSelector:@selector(animationDidStart:)];
    [UIView setAnimationDidStopSelector:@selector(animationDidStop:finished:)];
    
    [UIView setAnimationCurve:UIViewAnimationCurveEaseInOut];
    [UIView setAnimationTransition:transiton
                           forView:curView
                             cache:YES];
    
    if(transiton == UIViewAnimationTransitionNone)
    {
        [UIView	animateWithDuration:duration
                              delay:(0.0f)
                            options:(UIViewAnimationOptionAllowUserInteraction)
                         animations:^{
                             curView.transform		= CGAffineTransformMakeScale(1.1, 1.1);
                             curView.transform		= CGAffineTransformMakeScale(0.9, 0.9);
                         }
                         completion:^(BOOL finished){
                             curView.transform		= CGAffineTransformIdentity;
                         }
         ];	
    }
    
    [UIView	commitAnimations];
}


/********************************************************************
 *
 * Name			: showDailyWeatherAsWidth
 * Description	: showDailyWeatherAsWidth
 * Returns		: void
 * Side effects :
 * Date			: 2017. 01. 23
 * Author		: SeanKim
 * History		: 20170123 SeanKim Create function
 *
 ********************************************************************/
- (void) showDailyWeatherAsWidth
{
    TodayViewController *TVC = [TodayViewController sharedInstance];
    NSLog(@"[showDailyWeatherAsWidth] TVC.view.bounds.size.width :%f", TVC.view.bounds.size.width);
    // actual width is 304, margin is 16
    if(TVC.view.bounds.size.width <= 320.00)
    {
        dispatch_async(dispatch_get_main_queue(), ^{
            TVC->time6Label.hidden      = YES;
            TVC->temp6Label.hidden      = YES;
            TVC->showMore6IV.hidden     = YES;
            
            TVC->time1Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN, 10, FIVE_DAILY_WT_WIDTH, 21);
            TVC->time2Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH, 10, FIVE_DAILY_WT_WIDTH, 21);
            TVC->time3Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH*2, 10, FIVE_DAILY_WT_WIDTH, 21);
            TVC->time4Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH*3, 10, FIVE_DAILY_WT_WIDTH, 21);
            TVC->time5Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH*4, 10, FIVE_DAILY_WT_WIDTH, 21);
            
            TVC->showMore1IV.frame      = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_IMG_MARGIN, 36, FIVE_DAILY_IMG_WIDTH, FIVE_DAILY_IMG_HEIGHT);
            TVC->showMore2IV.frame      = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_IMG_MARGIN*3 + FIVE_DAILY_IMG_WIDTH, 36, FIVE_DAILY_IMG_WIDTH, FIVE_DAILY_IMG_HEIGHT);
            TVC->showMore3IV.frame      = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_IMG_MARGIN*5 + FIVE_DAILY_IMG_WIDTH*2, 36, FIVE_DAILY_IMG_WIDTH, FIVE_DAILY_IMG_HEIGHT);
            TVC->showMore4IV.frame      = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_IMG_MARGIN*7 + FIVE_DAILY_IMG_WIDTH*3, 36, FIVE_DAILY_IMG_WIDTH, FIVE_DAILY_IMG_HEIGHT);
            TVC->showMore5IV.frame      = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_IMG_MARGIN*9 + FIVE_DAILY_IMG_WIDTH*4, 36, FIVE_DAILY_IMG_WIDTH, FIVE_DAILY_IMG_HEIGHT);
            
            TVC->temp1Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN, 80, FIVE_DAILY_WT_WIDTH, 21);
            TVC->temp2Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH, 80, FIVE_DAILY_WT_WIDTH, 21);
            TVC->temp3Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH*2, 80, FIVE_DAILY_WT_WIDTH, 21);
            TVC->temp4Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH*3, 80, FIVE_DAILY_WT_WIDTH, 21);
            TVC->temp5Label.frame       = CGRectMake(FIVE_DAILY_WT_WMARGIN + FIVE_DAILY_WT_WIDTH*4, 80, FIVE_DAILY_WT_WIDTH, 21);
        });
    }

}
                           
/********************************************************************
 *
 * Name			: getCurCountry
 * Description	: get current country
 * Returns		: NSString *
 * Side effects :
 * Date			: 2017. 2. 19
 * Author		: SeanKim
 * History		: 20170219 SeanKim Create function
 *
 ********************************************************************/
- (NSString *) getCurCountry
{
    return curCountry;
}

/********************************************************************
 *
 * Name			: setCurCountry
 * Description	: set current country
 * Returns		: void
 * Side effects :
 * Date			: 2017. 3. 1
 * Author		: SeanKim
 * History		: 20170301 SeanKim Create function
 *
 ********************************************************************/
- (void) setCurCountry:(NSString *)nssCountry
{
    curCountry = [NSString stringWithFormat:@"%@", nssCountry];
}

@end
