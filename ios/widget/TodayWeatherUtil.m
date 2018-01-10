//
//  TodayWeatherUtil.m
//  TodayWeather
//
//  Created by KwangHo Kim on 2016. 11. 20..
//
//

#import "TodayWeatherUtil.h"

TEMP_UNIT    gTemperatureUnit;

@implementation TodayWeatherUtil
@synthesize twuCountry;
@synthesize nsmaDaumKeys;

/********************************************************************
 *
 * Name			: WFLOG
 * Description	: Wizard Factory LOG
 * Returns		: void
 * Side effects :
 * Date			: 2017. 02. 13
 * Author		: SeanKim
 * History		: 20170213 SeanKim Create function
 *
 ********************************************************************/


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
 * Name			: getDaysArray type
 * Description	: get days array 
 * Returns		: NSMutableArray *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSArray *) getDaysArray:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType
{
    NSDictionary    *dictMidData = nil;
    NSArray         *arrDailyData = nil;
    NSDate          *nsdYesteray = nil;
    int             yesterdayDate = 0;
    int             cntArrDaily = 0;
    int             cntFounded = 0;
    
    NSMutableArray         *arrDaysData = [[NSMutableArray alloc] init];
    
    if(reqType == TYPE_REQUEST_WEATHER_KR)
    {
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
    }
    else
    {
        arrDailyData    = [jsonDict  objectForKey:@"daily"];
        cntArrDaily     = (int)[arrDailyData count];

        for(int i = 0; i < cntArrDaily; i++)
        {
            NSDictionary    *nsdDailyData   = [arrDailyData objectAtIndex:i];
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
+ (NSMutableArray *) getByTimeArray:(NSDictionary *)jsonDict type:(TYPE_REQUEST)reqType
{
    NSMutableArray *arrByTimeData   = [[NSMutableArray alloc] init];
    
    NSDictionary    *currentDict    = nil;
    NSString        *nssDate        = nil;
    NSString        *nssTime        = nil;
    NSString        *nssDateTime    = nil;
    long long currentDateTime       = 0;
    NSMutableArray  *arrHourlyData   = nil;
    int             cntFounded      = 0;
    
    if(reqType == TYPE_REQUEST_WEATHER_KR)
    {
        currentDict    = [jsonDict objectForKey:@"current"];
        nssDate        = [currentDict objectForKey:@"date"];
        nssTime        = [currentDict objectForKey:@"time"];
        nssDateTime    = [NSString stringWithFormat:@"%@%@", nssDate, nssTime];
        
        currentDateTime            = [nssDateTime longLongValue];
        arrHourlyData = [jsonDict objectForKey:@"short"];
        
        //NSLog(@"getByTimeArray jsonDict : %@", jsonDict);
        //NSLog(@"getByTimeArray arrHourlyData : %@", arrHourlyData);
    
        for(int i = 0; i < [arrHourlyData count]; i++)
        {
            NSMutableDictionary *dictShort = [arrHourlyData objectAtIndex:i];
            NSString *nssDate = [dictShort objectForKey:@"date"];
            NSString *nssTime = [dictShort objectForKey:@"time"];
            long long hourlyDateTime = [self makeIntTimeWithDate:nssDate time:nssTime];
            
            if(currentDateTime <= hourlyDateTime)
            {
                NSLog(@"nssDate : %@, time : %@, currentDateTime: %lld, shortDateTime: %lld", nssDate, nssTime, currentDateTime, hourlyDateTime);
                [arrByTimeData addObject:dictShort];
                
                cntFounded++;
                
                if(cntFounded == 6)
                    break;
            }
        }
    }
    else
    {
        NSArray *arrThisTime        = [jsonDict objectForKey:@"thisTime"];
        if([arrThisTime count] == 2)
            currentDict         = [arrThisTime objectAtIndex:1];        // Use second index; That is current weahter.
        else
            currentDict         = [arrThisTime objectAtIndex:0];        // process about thisTime
        
        NSString    *nssTmpDate     = [currentDict objectForKey:@"date"];                   // 2017.02.25 00:00
        
        NSArray *arrDate            = [nssTmpDate componentsSeparatedByString:@" "];        // "2017.02.25", "00:00"
        NSString *nssSeparatedDate  = [arrDate objectAtIndex:0];                            // "2017.02.25"
        NSArray *arrSeparatedDate   = [nssSeparatedDate componentsSeparatedByString:@"."];  // "2017", "02" ,"25"
        nssDate                     = [NSString stringWithFormat:@"%@%@%@",
                                       [arrSeparatedDate objectAtIndex:0],
                                       [arrSeparatedDate objectAtIndex:1],
                                       [arrSeparatedDate objectAtIndex:2]];                 // "20170205"
        
        NSString *nssSeparatedTime  = [arrDate objectAtIndex:1];                            // "00:00"
        NSArray  *arrSeparatedTime  = [nssSeparatedTime componentsSeparatedByString:@":"];  // "00", "00"
        nssTime                     = [NSString stringWithFormat:@"%@%@",
                                       [arrSeparatedTime objectAtIndex:0],
                                       [arrSeparatedTime objectAtIndex:1]];
        
        currentDateTime             = [self makeIntTimeWithDate:nssDate time:nssTime];
        
        arrHourlyData               = [jsonDict objectForKey:@"hourly"];
        
        //NSLog(@"[getByTimeArray] arrHourlyData : %@", arrHourlyData);
        
        for(int i = 0; i < [arrHourlyData count]; i++)
        {
            NSMutableDictionary *dictShort = [arrHourlyData objectAtIndex:i];
            
            NSString *nssDateTmpHourly = [dictShort objectForKey:@"date"];
            
            NSArray  *arrDateHourly             = [nssDateTmpHourly componentsSeparatedByString:@" "];        // "2017.02.25", "00:00"
            NSString *nssSeparatedDateHourly    = [arrDateHourly objectAtIndex:0];                            // "2017.02.25"
            NSArray  *arrSeparatedDateHourly    = [nssSeparatedDateHourly componentsSeparatedByString:@"."];  // "2017", "02" ,"25"
            NSString *nssDateHourly             = [NSString stringWithFormat:@"%@%@%@",
                                           [arrSeparatedDateHourly objectAtIndex:0],
                                           [arrSeparatedDateHourly objectAtIndex:1],
                                           [arrSeparatedDateHourly objectAtIndex:2]];                 // "20170205"
            
            NSString *nssSeparatedTimeHourly  = [arrDateHourly objectAtIndex:1];                            // "00:00"
            NSArray  *arrSeparatedTimeHourly  = [nssSeparatedTimeHourly componentsSeparatedByString:@":"];  // "00", "00"
            NSString *nssTimeHourly                     = [NSString stringWithFormat:@"%@%@",
                                           [arrSeparatedTimeHourly objectAtIndex:0],
                                           [arrSeparatedTimeHourly objectAtIndex:1]];

            long long hourlyDateTime = [self makeIntTimeWithDate:nssDateHourly time:nssTimeHourly];
                        
            if(currentDateTime <= hourlyDateTime)
            {
                NSLog(@"nssDate : %@, time : %@, currentDateTime: %lld, shortDateTime: %lld", nssDate, nssTime, currentDateTime, hourlyDateTime);
                [arrByTimeData addObject:dictShort];
                
                cntFounded++;
                
                if(cntFounded == 6)
                    break;
            }
        }
    }
    
    return arrByTimeData;
}

/********************************************************************
 *
 * Name			: getTodayDictionary
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
            //NSLog(@"nssCurrentDate : %@, nssDailyDate : %@", nssCurrentDate, nssDailyDate);
            todayDict = [NSMutableDictionary dictionaryWithDictionary:dailyDataDict];
            
            break;
        }
    }
    
    //NSLog(@"todayDict: %@", todayDict);
    
    return todayDict;
}

/********************************************************************
 *
 * Name			: getTodayDictionaryInGlobal
 * Description	: get today dictionary in global weather data
 * Returns		: NSMutableDictionary *
 * Side effects :
 * Date			: 2017. 02. 18
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (NSMutableDictionary *) getTodayDictionaryInGlobal:(NSDictionary *)jsonDict time:(NSString *)nssTime
{
    NSString        *nssCurrentDate = nil;
    if( ( [nssTime length] >= 10 ) || (nssTime == nil) )
    {
        nssCurrentDate        = [nssTime substringToIndex:10];
    }
    else
    {
        nssCurrentDate        = @"";
    }
    
    NSMutableArray  *dailyDataArr         = [jsonDict objectForKey:@"daily"];
    NSMutableDictionary    *todayDict     = [[NSMutableDictionary alloc] init];
    
    //NSLog(@"[getTodayDictionaryInGlobal] nssCurrentDate : %@", nssCurrentDate);
    
    for(int i = 0; i < [dailyDataArr count]; i++)
    {
        NSDictionary *dailyDataDict = [dailyDataArr objectAtIndex:i];
        NSString *nssDate       = [dailyDataDict objectForKey:@"date"];
        NSString *nssDailyDate  = [nssDate substringToIndex:10];
        
        //NSLog(@"[getTodayDictionaryInGlobal] nssCurrentDate : %@, nssDailyDate : %@", nssCurrentDate, nssDailyDate);
        if([nssCurrentDate isEqualToString:nssDailyDate])
        {
            //NSLog(@"[getTodayDictionaryInGlobal] nssCurrentDate : %@, nssDailyDate : %@", nssCurrentDate, nssDailyDate);
            todayDict = [NSMutableDictionary dictionaryWithDictionary:dailyDataDict];
            
            break;
        }
    }
    
    //NSLog(@"todayDict: %@", todayDict);
    
    return todayDict;
}

/********************************************************************
 *
 * Name			: setTemperatureUnit
 * Description	: set temperature unit by NSDefaults
 * Returns		: TEMP_UNIT
 * Side effects :
 * Date			: 2017. 3. 27
 * Author		: SeanKim
 * History		: 20170327 SeanKim Create function
 *
 ********************************************************************/
+ (void) setTemperatureUnit:(NSString *)nssUnits
{
    if(nssUnits == nil)
    {
        NSLog(@"nssUnits is null!!!");
        return;
    }
    
    NSError *error;
    NSData *tmpUnitData = [nssUnits dataUsingEncoding:NSUTF8StringEncoding];
    
    if(tmpUnitData)
    {
        NSDictionary *jsonUnitDict = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpUnitData options:0 error:&error];
        NSString    *nsdTempUnit    = [jsonUnitDict objectForKey:@"temperatureUnit"];
        NSLog(@"nsdTempUnit : %@", nsdTempUnit);
        
        if([nsdTempUnit isEqualToString:@"F"])
        {
            gTemperatureUnit = TEMP_UNIT_FAHRENHEIT;
        }
        else
        {
            gTemperatureUnit = TEMP_UNIT_CELSIUS;
        }
        
        //FIXME
        //gTemperatureUnit = TEMP_UNIT_FAHRENHEIT;
    }
    
    return;
}

/********************************************************************
 *
 * Name			: getTemperatureUnit
 * Description	: get temperature unit by country
 * Returns		: TEMP_UNIT
 * Side effects :
 * Date			: 2017. 2. 19
 * Author		: SeanKim
 * History		: 20170219 SeanKim Create function
 *
 ********************************************************************/
+ (TEMP_UNIT) getTemperatureUnit
{
    NSLog(@"gTemperatureUnit : %d", gTemperatureUnit);
    return gTemperatureUnit;
}

/********************************************************************
 *
 * Name			: convertFromCelsToFahr
 * Description	: convert From Celsius To Fahrenheit
 * Returns		: float
 * Side effects :
 * Date			: 2017. 3. 27
 * Author		: SeanKim
 * History		: 20170327 SeanKim Create function
 *
 ********************************************************************/
//섭씨 => 화씨	°F = °C × 1.8 + 32
//화씨 => 섭씨	°C = (°F − 32) / 1.8
+ (float) convertFromCelsToFahr:(float)cels
{
    float fahr = cels * 1.8 + 32;
    
    return fahr;
}

/********************************************************************
 *
 * Name			: processLocationStr
 * Description	: processed locations 2 decimal places.
 * Returns		: NSString *
 * Side effects :
 * Date			: 2017. 2. 23
 * Author		: SeanKim
 * History		: 20170219 SeanKim Create function
 *
 ********************************************************************/
+ (NSString *) processLocationStr:(NSString *)nssSrcStr
{
    NSString *nssDstStr = nil;
    
    if(nssSrcStr == nil)
    {
        NSLog(@"[processLocationStr] nssSrcStr is nil!!!");
        return nil;
    }

    NSLog(@"[processLocationStr] nssSrcStr : %@", nssSrcStr);
    
    NSArray *arrSrc     = [nssSrcStr componentsSeparatedByString:@"."];
    NSString *nssFirst  = [arrSrc objectAtIndex:0];
    //NSLog(@"[processLocationStr] nssFirst : %@", nssFirst);
    NSString *nssTmp    = [arrSrc objectAtIndex:1];
    
    NSString *nssSecond = nil;
    if(nssTmp == nil)
    {
        nssDstStr   = [NSString stringWithFormat:@"%@.0", nssFirst];
    }
    else
    {
        if( [nssTmp length] < 2 )
        {
            nssDstStr   = [NSString stringWithFormat:@"%@.%@", nssFirst, nssTmp];
        }
        else
        {
            nssSecond = [nssTmp substringToIndex:2];
            nssDstStr   = [NSString stringWithFormat:@"%@.%@", nssFirst, nssSecond];
        }
    }
    
    NSLog(@"[processLocationStr] nssDstStr : %@", nssDstStr);
    
    return nssDstStr;
}

/********************************************************************
 *
 * Name			: shuffleDatas
 * Description	: shuffle Datas
 * Returns		: NSString *
 * Side effects :
 * Date			: 2017. 5. 25
 * Author		: SeanKim
 * History		: 20170525 SeanKim Create function
 *
 ********************************************************************/
+ (NSMutableArray *) shuffleDatas:(NSMutableArray *)nsaDatas
{
    int count = (int)[nsaDatas count];
    for (uint i = 0; i < count - 1; ++i)
    {
        // Select a random element between i and end of array to swap with.
        int nElements = count - i;
        int n = arc4random_uniform(nElements) + i;
        [nsaDatas exchangeObjectAtIndex:i withObjectAtIndex:n];
    }
    
    return nsaDatas;
}

/********************************************************************
 *
 * Name			: getDaumServiceKeys
 * Description	: get Daum Service Keys by NSDefaults
 * Returns		: void
 * Side effects :
 * Date			: 2017. 5. 27
 * Author		: SeanKim
 * History		: 20170527 SeanKim Create function
 *
 ********************************************************************/
- (NSMutableArray *) getDaumServiceKeys
{
    return nsmaDaumKeys;
}

/********************************************************************
 *
 * Name			: setDaumServiceKeys
 * Description	: set Daum Service Keys by NSDefaults
 * Returns		: void
 * Side effects :
 * Date			: 2017. 5. 27
 * Author		: SeanKim
 * History		: 20170527 SeanKim Create function
 *
 ********************************************************************/
- (void) setDaumServiceKeys:(NSString *)nssDaumKeys
{
    NSData *tmpData = nil;
    NSError *error;
    NSArray *nsaDaumKeys = nil;

    if(nssDaumKeys == nil)
    {
        NSLog(@"nssDaumKeys is null!!!");
        return;
    }
    
    NSLog(@"nsmaDaumKeys : %@", nssDaumKeys);
    tmpData = [nssDaumKeys dataUsingEncoding:NSUTF8StringEncoding];
    
    if(tmpData)
    {
        nsaDaumKeys = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpData options:0 error:&error];
        //NSArray  *nsaDaumKeys = [[NSArray alloc] initWithObjects:@"0", @"1", @"2", @"3", nil];
        
    #if 0
        for (int i = 0; i < [nsaDaumKeys count]; i++)
        {
            NSLog(@"original %d : %@", i, [nsaDaumKeys objectAtIndex:i]);
        }
    #endif
            
        nsmaDaumKeys = [[NSMutableArray alloc] initWithArray:nsaDaumKeys];
        
    #if 0
        // Use this code in requesting url to daum
        NSMutableArray *nsmaShufflKeys= [TodayWeatherUtil shuffleDatas:nsmaDaumKeys];
        
        for (int i = 0; i < [nsmaShufflKeys count]; i++)
        {
            NSLog(@"shuffled %d : %@", i, [nsmaShufflKeys objectAtIndex:i]);
        }
    #endif
    }
    
    return;
}

/**
 *
 * @param nssUnits
 */
- (void) setUnits:(NSString *)nssNewUnits
{
    NSError *error;
    NSData *tmpUnitData = [nssNewUnits dataUsingEncoding:NSUTF8StringEncoding];
    
    if(tmpUnitData)
    {
        jsonUnitsDict = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpUnitData options:0 error:&error];
    }
    else {
        NSLog(@"nssNewUnits is null!!!");
    }
}

- (NSDictionary *) getUnits
{
    return jsonUnitsDict;
}

/********************************************************************
 *
 * Name			: renderImageFromView
 * Description	: render image from view
 * Returns		: UIImage
 * Side effects :
 * Date			: 2017. 6. 20
 * Author		: SeanKim
 * History		: 20170620 SeanKim Create function
 *
 ********************************************************************/
+ (UIImage *)renderImageFromView:(UIView *)view withRect:(CGRect)frame transparentInsets:(UIEdgeInsets)insets
{
    CGSize imageSizeWithBorder = CGSizeMake(frame.size.width + insets.left + insets.right, frame.size.height + insets.top + insets.bottom);
    // Create a new context of the desired size to render the image
    UIGraphicsBeginImageContextWithOptions(imageSizeWithBorder, NO, 0);
    CGContextRef context = UIGraphicsGetCurrentContext();
    
    // Clip the context to the portion of the view we will draw
    CGContextClipToRect(context, (CGRect){{insets.left, insets.top}, frame.size});
    // Translate it, to the desired position
    CGContextTranslateCTM(context, -frame.origin.x + insets.left, -frame.origin.y + insets.top);
    
    CGContextSetAllowsAntialiasing(context, true);
    CGContextSetShouldAntialias(context, true);
    
    // Render the view as image
    [view.layer renderInContext:UIGraphicsGetCurrentContext()];
    
    // Fetch the image
    UIImage *renderedImage = UIGraphicsGetImageFromCurrentImageContext();
    
    // Cleanup
    UIGraphicsEndImageContext();
    
    return renderedImage;
}

@end
