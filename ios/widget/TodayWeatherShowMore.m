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
#import "TodayViewController.h"

@implementation TodayWeatherShowMore

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
- (void) processDailyData:(NSDictionary *)jsonDict
{
    NSArray         *arrDaysData = nil;
    int             taMax = 0;
    int             taMin = 0;
    NSString        *nssTempMaxMin = nil;
    
    NSString        *nssMonth = nil;
    NSString        *nssDay = nil;
    NSString        *nssDate = nil;
    
    NSString        *nssSkyIcon = nil;
    
    TodayViewController *TVC = [TodayViewController sharedInstance];

    arrDaysData         = [TodayWeatherUtil getDaysArray:jsonDict];
    
    for(int i = 0 ; i < [arrDaysData count]; i++)
    {
        nssDate             = [[arrDaysData objectAtIndex:i] objectForKey:@"date"];
        
        nssMonth            = [nssDate substringWithRange:NSMakeRange(4, 2)];
        nssDay              = [nssDate substringFromIndex:6];
        
        taMin               = [[[arrDaysData objectAtIndex:i] objectForKey:@"taMin"] intValue];
        taMax               = [[[arrDaysData objectAtIndex:i] objectForKey:@"taMax"] intValue];
        nssTempMaxMin       = [NSString stringWithFormat:@"%d˚/%d˚", taMin, taMax];
        
        nssSkyIcon          = [[arrDaysData objectAtIndex:i] objectForKey:@"skyIcon"];
        //NSLog(@"nssTempMaxMin : %@", nssTempMaxMin);
        
        dispatch_async(dispatch_get_main_queue(), ^{
            switch (i) {
                case 0:
                    TVC->time1Label.text = @"어제";//[NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp1Label.text = nssTempMaxMin;
                    TVC->showMore1IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 1:
                    TVC->time2Label.text = @"오늘";//[NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp2Label.text = nssTempMaxMin;
                    TVC->showMore2IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 2:
                    TVC->time3Label.text = @"내일";[NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp3Label.text = nssTempMaxMin;
                    TVC->showMore3IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 3:
                    TVC->time4Label.text = [NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp4Label.text = nssTempMaxMin;
                    TVC->showMore4IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 4:
                    TVC->time5Label.text = [NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp5Label.text = nssTempMaxMin;
                    TVC->showMore5IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 5:
                    TVC->time6Label.text = [NSString stringWithFormat:@"%@/%@", nssMonth, nssDay];
                    TVC->temp6Label.text = nssTempMaxMin;
                    TVC->showMore6IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
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
- (void) processByTimeData:(NSMutableDictionary *)dict
{
    NSArray     *arrTimeData = nil;
    NSString        *nssSkyIcon = nil;
    
    TodayViewController *TVC = [TodayViewController sharedInstance];
    
    arrTimeData = [TodayWeatherUtil getByTimeArray:dict];
    
    for(int i = 0 ; i < [arrTimeData count]; i++)
    {
        NSString  *nssTime           = [[arrTimeData objectAtIndex:i] objectForKey:@"time"];
        NSString *nssHour            = [nssTime substringToIndex:2];
        
        int t3h               = [[[arrTimeData objectAtIndex:i] objectForKey:@"t3h"] intValue];
        NSString *nssTempByTime       = [NSString stringWithFormat:@"%d˚", t3h];
        
        nssSkyIcon          = [[arrTimeData objectAtIndex:i] objectForKey:@"skyIcon"];
        
        NSLog(@"nssTempMaxMin : %@", nssTempByTime);
        
        dispatch_async(dispatch_get_main_queue(), ^{
            switch (i) {
                case 0:
                    TVC->time1Label.text    = [NSString stringWithFormat:@"%@시", nssHour];
                    TVC->temp1Label.text    = nssTempByTime;
                    TVC->showMore1IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 1:
                    TVC->time2Label.text = [NSString stringWithFormat:@"%@시", nssHour];
                    TVC->temp2Label.text = nssTempByTime;
                    TVC->showMore2IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 2:
                    TVC->time3Label.text = [NSString stringWithFormat:@"%@시", nssHour];
                    TVC->temp3Label.text = nssTempByTime;
                    TVC->showMore3IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 3:
                    TVC->time4Label.text = [NSString stringWithFormat:@"%@시", nssHour];
                    TVC->temp4Label.text = nssTempByTime;
                    TVC->showMore4IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 4:
                    TVC->time5Label.text = [NSString stringWithFormat:@"%@시", nssHour];
                    TVC->temp5Label.text = nssTempByTime;
                    TVC->showMore5IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
                    break;
                case 5:
                    TVC->time6Label.text = [NSString stringWithFormat:@"%@시", nssHour];
                    TVC->temp6Label.text = nssTempByTime;
                    TVC->showMore6IV.image  = [UIImage imageNamed:[NSString stringWithFormat:@"weatherIcon2-color/%@", nssSkyIcon]];
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
    
    NSString *nssKhaiStr          = [currentArpltnDict objectForKey:@"khaiStr"];  // 통합대기
    NSString *nssPm10Str          = [currentArpltnDict objectForKey:@"pm10Str"];  // 미세먼지
    NSString *nssPm25Str          = [currentArpltnDict objectForKey:@"pm25Str"];  // 초미세먼지
    
    NSLog(@"All air state is same!!! khaiGrade(%d), pm10Grade(%d), pm25Grade(%d)", khaiGrade, pm10Grade, pm25Grade);

    // Grade가 동일하면 통합대기 값을 전달, 동일할때 우선순위 통합대기 > 미세먼지 > 초미세먼지
    if( (khaiGrade == pm10Grade) && (pm10Grade == pm25Grade) )
    {
        return [NSString stringWithFormat:@"통합대기 %@", nssKhaiStr];
    }
    else
    {
        if( (khaiGrade > pm10Grade) && (khaiGrade > pm25Grade) )
        {
            return [NSString stringWithFormat:@"통합대기 %@", nssKhaiStr];
        }
        else if ( (khaiGrade == pm10Grade) && (khaiGrade > pm25Grade) )
        {
            return [NSString stringWithFormat:@"통합대기 %@", nssKhaiStr];
        }
        else if ( (khaiGrade < pm10Grade) && (khaiGrade > pm25Grade) )
        {
            return [NSString stringWithFormat:@"미세먼지 %@", nssPm10Str];
        }
        else if ( (khaiGrade > pm10Grade) && (khaiGrade == pm25Grade) )
        {
            return [NSString stringWithFormat:@"통합대기 %@", nssKhaiStr];
        }
        else if ( (khaiGrade < pm10Grade) && (khaiGrade == pm25Grade) )
        {
            return [NSString stringWithFormat:@"미세먼지 %@", nssPm10Str];
        }
        else if ( (khaiGrade > pm10Grade) && (khaiGrade < pm25Grade) )
        {
            return [NSString stringWithFormat:@"초미세먼지 %@", nssPm25Str];
        }
        else if ( (khaiGrade == pm10Grade) && (khaiGrade < pm25Grade) )
        {
            return [NSString stringWithFormat:@"초미세먼지 %@", nssPm25Str];
        }
        else if ( (khaiGrade < pm10Grade) && (khaiGrade < pm25Grade) )
        {
            if ( pm10Grade > pm25Grade)
            {
                return [NSString stringWithFormat:@"미세먼지 %@", nssPm10Str];
            }
            else if ( pm10Grade == pm25Grade)
            {
                return [NSString stringWithFormat:@"미세먼지 %@", nssPm10Str];
            }
            else if ( pm10Grade < pm25Grade)
            {
                return [NSString stringWithFormat:@"초미세먼지 %@", nssPm25Str];
            }
        }
    }
    
    return [NSString stringWithFormat:@"통합대기 %@", nssKhaiStr];
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


@end
