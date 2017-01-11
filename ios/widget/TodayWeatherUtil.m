//
//  TodayWeatherUtil.m
//  TodayWeather
//
//  Created by KwangHo Kim on 2016. 11. 20..
//
//

#import "TodayWeatherUtil.h"

@implementation TodayWeatherUtil

/********************************************************************
 *
 * Name			: getYYYYMMDDFromUTCTime
 * Description	: get YYYYMMDD Date from UTCTime
 * Returns		: int
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (int) getYYYYMMDDFromUTCTime:(unsigned int)UTCTime
{
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    
    NSDate *nsdTime = [NSDate dateWithTimeIntervalSince1970:UTCTime];
    
    [formatter setDateFormat:@"yyyyMMdd"];
    [formatter setLocale:[NSLocale	currentLocale]];
    
    NSString *nssTime		= [NSString stringWithFormat:@"%@", [formatter stringFromDate:nsdTime]];	// be calc Offset automatic
    int     time = [nssTime intValue];
    
    return time;
}

/********************************************************************
 *
 * Name			: makeIntTimeWithDate
 * Description	: make integer time with date
 * Returns		: long long
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (long long) makeIntTimeWithDate:(NSString*)nssDate time:(NSString *)nssTime
{
    NSString *nssMakeTime = [NSString stringWithFormat:@"%@%@", nssDate, nssTime];
    
    long long makeTime = [nssMakeTime longLongValue];
    
    return makeTime;
}

/********************************************************************
 *
 * Name			: makeNSDateWithDate
 * Description	: make NSDate with date
 * Returns		: NSDate *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSDate *) makeNSDateWithDate:(NSString*)nssDate time:(NSString *)nssTime
{
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    
    NSString *nssMakeTime = [NSString stringWithFormat:@"%@%@", nssDate, nssTime];
    
    [formatter setDateFormat:@"yyyyMMddHHmm"];
    [formatter setLocale:[NSLocale	currentLocale]];
    
    NSDate *nsdMakeTime = [formatter dateFromString:nssMakeTime];	// be calc Offset automatic
    
    return nsdMakeTime;
}

/********************************************************************
 *
 * Name			: getCurTime
 * Description	: get current time
 * Returns		: NSDate *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (NSTimeInterval) getCurTime
{
    NSDate *today = [NSDate date];
    
    NSTimeInterval nstCurrentTime = [today timeIntervalSinceDate:today];
    
    return nstCurrentTime;
}

/********************************************************************
 *
 * Name			: getYesterday
 * Description	: get yesterday date
 * Returns		: NSDate *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSDate *) getYesterday
{
    NSDate *today = [NSDate date];
    
    // All intervals taken from Google
    NSDate *yesterday = [today dateByAddingTimeInterval: -86400.0];
    
    return yesterday;
}

/********************************************************************
 *
 * Name			: getDaysArray
 * Description	: get days array
 * Returns		: NSMutableArray *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSMutableArray *) getDaysArray:(NSDictionary *)jsonDict
{
    NSDictionary    *dictMidData = nil;
    NSArray         *arrDailyData = nil;
    NSDate          *nsdYesteray = nil;
    int             yesterdayDate = 0;
    int             cntArrDaily = 0;
    int             cntFounded = 0;
    
    NSMutableArray         *arrDaysData = [[NSMutableArray alloc] init];
    
    dictMidData     = [jsonDict objectForKey:@"midData"];
    arrDailyData    = [dictMidData  objectForKey:@"dailyData"];
    
    nsdYesteray     = [self getYesterday];
    yesterdayDate   = [self getYYYYMMDDFromUTCTime:[nsdYesteray timeIntervalSince1970]];
    cntArrDaily     = (int)[arrDailyData count];
    
    NSLog(@"yesterdayDate : %d", yesterdayDate);
    
    for(int i = 0; i < cntArrDaily; i++)
    {
        NSDictionary    *nsdDailyData   = [arrDailyData objectAtIndex:i];
        NSString        *nssDate        = [nsdDailyData objectForKey:@"date"];
        int date                        = [nssDate intValue];
        
        if(date >= yesterdayDate)
        {
            //NSLog(@"date : %d", date);
            [arrDaysData addObject:nsdDailyData];
            
            cntFounded++;
            
            if(cntFounded == 6)
                break;
        }
    }
    
    //NSLog(@"arrDaysData : %@", arrDaysData);
    
    return arrDaysData;
}

/********************************************************************
 *
 * Name			: getByTimeArray
 * Description	: get array by time
 * Returns		: NSMutableArray *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSMutableArray *) getByTimeArray:(NSDictionary *)jsonDict
{
    NSMutableArray *arrByTimeData   = [[NSMutableArray alloc] init];
    NSDictionary    *currentDict    = [jsonDict objectForKey:@"current"];
    NSString        *nssDate        = [currentDict objectForKey:@"date"];
    NSString        *nssTime        = [currentDict objectForKey:@"time"];
    NSString        *nssDateTime    = [NSString stringWithFormat:@"%@%@", nssDate, nssTime];
    
    long long currentDateTime            = [nssDateTime longLongValue];
    NSMutableArray  *arrShortData = [jsonDict objectForKey:@"short"];
    int             cntFounded = 0;
    
    //NSLog(@"getByTimeArray dict : %@", jsonDict);
    
    for(int i = 0; i < [arrShortData count]; i++)
    {
        NSMutableDictionary *dictShort = [arrShortData objectAtIndex:i];
        NSString *nssDate = [dictShort objectForKey:@"date"];
        NSString *nssTime = [dictShort objectForKey:@"time"];
        long long shortDateTime = [self makeIntTimeWithDate:nssDate time:nssTime];
        
        if(currentDateTime <= shortDateTime)
        {
            NSLog(@"nssDate : %@, time : %@, currentDateTime: %lld, shortDateTime: %lld", nssDate, nssTime, currentDateTime, shortDateTime);
            [arrByTimeData addObject:dictShort];
            
            cntFounded++;
            
            if(cntFounded == 6)
                break;
        }
    }
    
    return arrByTimeData;
}

/********************************************************************
 *
 * Name			: getByTimeArray
 * Description	: get today dictionary
 * Returns		: NSMutableDictionary *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSMutableDictionary *) getTodayDictionary:(NSDictionary *)jsonDict
{
    NSDictionary    *currentDict    = [jsonDict objectForKey:@"current"];
    NSString        *nssCurrentDate        = [currentDict objectForKey:@"date"];
    
    NSDictionary    *midDict        = [jsonDict objectForKey:@"midData"];
    NSMutableArray  *dailyDataArr   = [midDict objectForKey:@"dailyData"];
    NSMutableDictionary    *todayDict     = [[NSMutableDictionary alloc] init];
    
    //NSLog(@"getTodayArray nssCurrentDate : %@", nssCurrentDate);
    
    for(int i = 0; i < [dailyDataArr count]; i++)
    {
        NSDictionary *dailyDataDict = [dailyDataArr objectAtIndex:i];
        NSString *nssDailyDate = [dailyDataDict objectForKey:@"date"];
        
        if([nssCurrentDate isEqualToString:nssDailyDate])
        {
            NSLog(@"nssCurrentDate : %@, nssDailyDate : %@", nssCurrentDate, nssDailyDate);
            todayDict = [NSMutableDictionary dictionaryWithDictionary:dailyDataDict];
            
            break;
        }
    }
    
    //NSLog(@"todayDict: %@", todayDict);
    
    return todayDict;
}


@end
