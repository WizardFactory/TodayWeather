//
//  TodayViewController.m
//  widget
//
//  Created by KwangHo Kim on 2016. 5. 28..
//
//

#import "TodayViewController.h"
#import <NotificationCenter/NotificationCenter.h>

#import "WidgetConfig.h"
#import "TodayWeatherUtil.h"
#import "LocalizationDefine.h"

/********************************************************************
 Enumration
 ********************************************************************/

/********************************************************************
 Definitions
 ********************************************************************/
#define USE_DEBUG                       0
#define EMUL_TEST                       1

#define STR_GOOGLE_COORD2ADDR_URL       @"https://maps.googleapis.com/maps/api/geocode/json?latlng="
#define STR_GOOGLE_ADDR2COORD_URL       @"https://maps.googleapis.com/maps/api/geocode/json?address="
#define STR_APIKEY                      @"?apikey="
#define STR_LONGITUDE                   @"&longitude="
#define STR_LATITUDE                    @"&latitude="
#define STR_INPUT_COORD                 @"&inputCoordSystem=WGS84"
#define STR_OUTPUT_JSON                 @"&output=json"
//#define API_JUST_TOWN                   @"v000803/town"
#define WORLD_API_URL                   @"ww/010000/current/2?gcode="
//#define TEST_SERVER                     @"https://ry0b7u7o1b.execute-api.ap-northeast-2.amazonaws.com/dev"
#define COORD_2_WEATHER_API_URL         @"weather/coord"
#define KMA_ADDR_API_URL                @"v000901/kma/addr"

#define WIDGET_COMPACT_HEIGHT           110.0
#define WIDGET_PADDING                  215.0



/********************************************************************
 Interface
 ********************************************************************/
@interface TodayViewController () <NCWidgetProviding>

@end

/********************************************************************
 Class Implementation
 ********************************************************************/
@implementation CityInfo
- (void)encodeWithCoder:(NSCoder *)coder;
{
    [coder encodeBool:_currentPosition forKey:@"currentPosition"];
    [coder encodeObject:_address forKey:@"address"];
    [coder encodeInt:_index forKey:@"index"];
    [coder encodeObject:_name forKey:@"name"];
    [coder encodeObject:_country forKey:@"country"];
    [coder encodeObject:_location forKey:@"location"];
}

- (id)initWithCoder:(NSCoder *)coder;
{
    self = [super init];
    if (self != nil)
    {
        _currentPosition = [coder decodeBoolForKey:@"currentPosition"];
        _address = [coder decodeObjectForKey:@"address"];
        _index = [coder decodeIntForKey:@"index"];
        _name = [coder decodeObjectForKey:@"name"];
        _country = [coder decodeObjectForKey:@"country"];
        _location = [coder decodeObjectForKey:@"location"];
    }
    return self;
}
@end

@implementation TodayViewController

@synthesize locationManager;
@synthesize startingPoint;
@synthesize responseData;
@synthesize loadingIV;

static TodayViewController *todayVC = nil;

/********************************************************************
 *
 * Name			: sharedInstance
 * Description	: For shared instance (singleton)
 * Returns		: TodayViewController *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
+ (TodayViewController *)sharedInstance {
    if(todayVC == nil)
    {
        DebugLog(@"todayVC : %@", todayVC);
        
        todayVC = [[TodayViewController alloc] initWithNibName:@"TodayViewController"			bundle:nil];
    }

    return todayVC;
}

/********************************************************************
 *
 * Name			: initWithNibName
 * Description	: init with nib name
 * Returns		: id
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (id)initWithNibName:(NSString *)nibNameOrNil bundle:(NSBundle *)nibBundleOrNil
{
    self = [super initWithNibName:nibNameOrNil bundle:nibBundleOrNil];
    if (self)
    {
    }
    
    return self;
}

/********************************************************************
 *
 * Name			: viewDidLoad
 * Description	: process when view did load
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 22
 * Author		: SeanKim
 * History		: 20160622 SeanKim Create function
 *
 ********************************************************************/
- (void)viewDidLoad
{
    [super viewDidLoad];

    //DebugLog(@"self : %@", self);
    
    NSString *budleDisplayName = [[[NSBundle mainBundle] localizedInfoDictionary] objectForKey:@"CFBundleDisplayName"];
    DebugLog(@"Localized Bundle Display Nmae : %@ ", budleDisplayName);
    
    todayVC = self;
     
    [self processRequestIndicator:TRUE];
    [self initWidgetDatas];
    //[self processShowMore];
    self.extensionContext.widgetLargestAvailableDisplayMode = NCWidgetDisplayModeCompact;
    showMoreView.hidden = true;
}

/********************************************************************
 *
 * Name			: processShowMore
 * Description	: process ShowMore feature
 * Returns		: void
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (void) processShowMore
{
    // This will remove extra separators from tableview
    //self.articleTableView.tableFooterView = [[UIView alloc] initWithFrame:CGRectZero];
    
    NSOperatingSystemVersion nsOSVer = [[NSProcessInfo processInfo] operatingSystemVersion];
    DebugLog(@"version : %ld.%ld.%ld", (long)nsOSVer.majorVersion, (long)nsOSVer.minorVersion, (long)nsOSVer.patchVersion);
    
    if(nsOSVer.majorVersion >= 10)
    {
        // Add the iOS 10 Show More ability
        NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair"];
        NSString *cityList = [sharedUserDefaults objectForKey:@"cityList"];

                dispatch_async(dispatch_get_main_queue(), ^{
        if(cityList == nil)
        {
            DebugLog(@"Widget Mode is Compact!!!");
            [self.extensionContext setWidgetLargestAvailableDisplayMode:NCWidgetDisplayModeCompact];
        }
        else
        {
            DebugLog(@"Widget Mode is Expanded!!!");
            [self.extensionContext setWidgetLargestAvailableDisplayMode:NCWidgetDisplayModeExpanded];
        }
                    });
    }
    else
    {
        dispatch_async(dispatch_get_main_queue(), ^{
            addressLabel.textColor  = [UIColor lightGrayColor];
            curAirLabel.textColor  = [UIColor lightGrayColor];
            todayMaxMinTempLabel.textColor = [UIColor lightGrayColor];
            noLocationLabel.textColor = [UIColor lightGrayColor];
            showMoreView.hidden = YES;
            
            CGSize currentSize = self.preferredContentSize;
            currentSize.height = WIDGET_COMPACT_HEIGHT;
            self.preferredContentSize = currentSize;
        });
        DebugLog(@"This OSVersion can't use Show More feature!!!");
    }
    
    
    [todayWSM showDailyWeatherAsWidth];
}

/********************************************************************
 *
 * Name			: widgetActiveDisplayModeDidChange
 * Description	: widgetActiveDisplayModeDidChange
 * Returns		: void
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
#if 0
- (void)widgetActiveDisplayModeDidChange:(NCWidgetDisplayMode)activeDisplayMode withMaximumSize:(CGSize)maxSize
{
    if (activeDisplayMode == NCWidgetDisplayModeCompact){
        // Changed to compact mode
        self.preferredContentSize   = maxSize;
        showMoreView.hidden         = true;
        DebugLog(@"NCWidgetDisplayModeCompact width : %f, height : %f", self.preferredContentSize.width, self.preferredContentSize.height);
    }
    else
    {
        // Changed to expanded mode
        self.extensionContext.widgetLargestAvailableDisplayMode = NCWidgetDisplayModeExpanded;
        self.preferredContentSize   = CGSizeMake(self.view.frame.size.width, WIDGET_PADDING);
        showMoreView.hidden         = false;
        DebugLog(@"expanded height : %f", self.preferredContentSize.height);
    }
}
#endif
/********************************************************************
 *
 * Name            : viewWillAppear
 * Description    : process when view(widget) is appear
 * Returns        : void
 * Side effects :
 * Date            : 2018. 02. 24
 * Author        : SeanKim
 * History        : 20180224 SeanKim Create function
 *
 ********************************************************************/
#if 0
- (void)viewWillAppear:(BOOL)animated
{
    [super viewWillAppear:animated];
    
    NSOperatingSystemVersion nsOSVer = [[NSProcessInfo processInfo] operatingSystemVersion];
    if(nsOSVer.majorVersion >= 10)
    {
        DebugLog(@"[viewWillAppear] os version is 10 more.");
    }
    else
    {
        DebugLog(@"[viewWillAppear] preffered content size have to be changed");
        dispatch_async(dispatch_get_main_queue(), ^{
            CGSize currentSize = self.preferredContentSize;
            currentSize.height = WIDGET_COMPACT_HEIGHT;
            self.preferredContentSize = currentSize;
        });
    }
}
#endif
/********************************************************************
 *
 * Name			: viewDidAppear
 * Description	: process when view(widget) is appear
 * Returns		: void
 * Side effects :
 * Date			: 2016. 10. 25
 * Author		: SeanKim
 * History		: 20161025 SeanKim Create function
 *
 ********************************************************************/
- (void)viewDidAppear:(BOOL)animated
{
    [super viewDidAppear:animated];
    
    [self processRequestIndicator:TRUE];
}

/********************************************************************
 *
 * Name			: viewDidAppear
 * Description	: process when view(widget) is disappear
 * Returns		: void
 * Side effects :
 * Date			: 2016. 10. 24
 * Author		: SeanKim
 * History		: 20161024 SeanKim Create function
 *
 ********************************************************************/
- (void)viewDidDisappear:(BOOL)animated
{
    [super viewDidDisappear:animated];

    [locationManager stopUpdatingLocation];
}

- (void) initWidgetViews
{
    if ([mCityList count] <= 1) {
        DebugLog(@"hide next city btn");
        nextCityBtn.hidden = true;
        addressLabel.hidden = false;
    }
    else
    {
        nextCityBtn.hidden = false;
        addressLabel.hidden = false;
    }
}

/********************************************************************
 *
 * Name			: initWidgetDatas
 * Description	: initialize widget datas
 * Returns		: void
 * Side effects :
 * Date			: 2016. 10. 25
 * Author		: SeanKim
 * History		: 20161025 SeanKim Create function
 *
 ********************************************************************/
- (void) initWidgetDatas
{
    NSError *error;
    NSDictionary *jsonDict;
    NSData *tmpData = nil;
    
    todayWSM = [[TodayWeatherShowMore alloc] init];
    todayUtil = [[TodayWeatherUtil alloc] init];
    
    todayWSM.curAirDataDict = [[NSMutableDictionary alloc] initWithObjectsAndKeys:
                               @"", @"airTitle",
                               @"", @"pm10Color",
                               @"", @"pm25Color",
                               @"", @"o3Color",
                               nil];
    //DebugLog(@"width : %f", self.view.bounds.size.width);
    
    
    bIsDateView = true;
    [twAppBtn setTitle:LSTR_TODAYWEATHER forState:UIControlStateNormal];
    //[twAppBtn sizeToFit];
    noLocationLabel.text     = LSTR_PLEASE_EXECUTE_MAIN_APP;

    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair"];
    NSString *cityList = [sharedUserDefaults objectForKey:@"cityList"];
    NSString *nssUnits = [sharedUserDefaults objectForKey:@"units"];
    
    [TodayWeatherUtil setTemperatureUnit:nssUnits];
    [todayUtil setUnits:nssUnits];
    //DebugLog(@"cityList : %@", cityList);

    tmpData = [cityList dataUsingEncoding:NSUTF8StringEncoding];
    if(tmpData)
        jsonDict = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpData options:0 error:&error];
    //DebugLog(@"User Default : %@", jsonDict);

    int index = 0;
    mCityList           = [NSMutableArray array];
    mCityDictList       = [NSMutableArray array];
    
    for (NSDictionary *cityDict in jsonDict[@"cityList"]) {
        CityInfo *city = [[CityInfo alloc] init];
        city.currentPosition = [cityDict[@"currentPosition"] boolValue];
        city.address = cityDict[@"address"];
        city.index = index++;
        city.appIndex = [cityDict[@"index"] intValue];
        city.name = cityDict[@"name"];
        city.country = cityDict[@"country"];
        city.location = cityDict[@"location"];
        DebugLog(@"index : %d, appIndex : %d, current position : %@ address %@, name : %@, country : %@",
              city.index, city.appIndex, city.currentPosition?@"true":@"false", city.address, city.name, city.country);
        //DebugLog(@"location : %@", city.location);
        
        //cityData.location = {"lat": coords.latitude, "long": coords.longitude};
        [mCityList addObject:city];
        [mCityDictList addObject:cityDict];
        //DebugLog(@"cityDict : %@", cityDict);
    }
    
    [self loadWeatherData:(unsigned int)[mCityDictList count]];
    
    CityInfo *currentCity = nil;
    CityInfo *savedCity = nil;
    NSData *archivedObject = [sharedUserDefaults objectForKey:@"currentCity"];
    //DebugLog(@"archivedObject : %@", archivedObject);
    savedCity = (CityInfo *)[NSKeyedUnarchiver unarchiveObjectWithData:archivedObject];
    if (savedCity == nil) {
        currentCity = mCityList.firstObject;
    }
    else {
        if (0 <= savedCity.index && savedCity.index < [mCityList count]) {
            currentCity = mCityList[savedCity.index];
            DebugLog(@"load last city info index %d",savedCity.index);
        }
        else {
            DebugLog(@"invalid index %d, so set first city",savedCity.index);
            currentCity = mCityList.firstObject;
        }
    }
    
    //DebugLog(@"country : %@", currentCity.country);
    //DebugLog(@"weatherData : %@", currentCity.weatherData);
    //DebugLog(@"location : %@", currentCity.location);
    //DebugLog(@"name : %@", currentCity.name);
    //DebugLog(@"address : %@", currentCity.address);
    
    dispatch_async(dispatch_get_main_queue(), ^{
        if (cityList == nil) {
            //You have to run todayweather for add citylist
            DebugLog(@"show no location view");

#if EMUL_TEST
            noLocationView.hidden   = FALSE;
            locationView.hidden     = TRUE;
            showMoreView.hidden     = TRUE;
            return;
#else
            noLocationView.hidden = TRUE;
            locationView.hidden = FALSE;
            addressLabel.text   = currentCity.name;
            
            [self initWidgetViews];
#endif
        }
        else {
            noLocationView.hidden = TRUE;
            locationView.hidden = FALSE;
            addressLabel.text   = currentCity.name;
            
            [self initWidgetViews];
        }
        //fineDustView.hidden = true;
    });
    
    
    [self setCityInfo:currentCity];
}

- (void) loadWeatherData:(unsigned int)cityCount
{
    NSError *errorWD;
    NSDictionary *jsonDictWD;
    NSData *tmpDataWD = nil;
    
    // User Defaults WD
    NSUserDefaults *sharedUserDefaultsWD = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair.weatherData"];
    NSString *nssWeatherList = [sharedUserDefaultsWD objectForKey:@"weatherDataList"];
//    DebugLog(@"[loadWeatherData] nssWeatherList: %@", nssWeatherList);
    tmpDataWD = [nssWeatherList dataUsingEncoding:NSUTF8StringEncoding];
    if(tmpDataWD)
    {
        jsonDictWD = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpDataWD options:0 error:&errorWD];
    }
    
    // Too many data causes crash, just use debug
    //DebugLog(@"User Default WD: %@", jsonDictWD);
    
    mWeatherDataList    = [NSMutableArray array];
    
    for (NSDictionary *weatherDict in jsonDictWD[@"weatherDataList"]) {
        
        //DebugLog(@"[loadWeatherData] weatherDict : %@", weatherDict);
    	[mWeatherDataList addObject:weatherDict];
    }
    
    DebugLog(@"[mWeatherDataList count] : %ld, cityCount : %d", (unsigned long)[mWeatherDataList count], cityCount);
    
    if([mWeatherDataList count] == 0)
    {
        for (int i = 0; i < cityCount; i++)
        {
            NSNumber *nsnIdx = [NSNumber numberWithUnsignedInteger:i];
            NSMutableDictionary* nsdTmpDict = [NSMutableDictionary dictionaryWithObjectsAndKeys:
                                                nsnIdx, @"index",
                                                @"", @"weatherData",
                                                nil];
                
            [mWeatherDataList addObject:nsdTmpDict];
        }
    }
    
    // Too many data causes crash
    //DebugLog(@"[loadWeatherData] mWeatherDataList : %@", mWeatherDataList);
}

/********************************************************************
*
* Name			: saveWeatherInfo
* Description	: save dictionay weather info
* Returns		: void
* Side effects :
* Date			: 2016. 11. 02
* Author		: SeanKim
* History		: 20161102 SeanKim Create function
*
********************************************************************/
- (void) saveWeatherInfo:(NSDictionary *)dict
{
    NSError *error = nil;
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair.weatherData"];
    
    NSNumber    *nsnIdx = nil;
    
    if(mCityDictList == nil)
    {
        DebugLog(@"mCityDictList is nil");
        return;
    }
    [self printCurrentAppGroupData];
    if([mCityDictList count] <= mCurrentCityIdx)
    {
        DebugLog(@"idx(%d/%ld) is invalid!!!", mCurrentCityIdx,  [mCityDictList count]);
        return;
    }
    
    //DebugLog(@"[saveWeatherInfo] dict : %@", dict);
    
    nsnIdx = [NSNumber numberWithUnsignedInteger:mCurrentCityIdx];
    DebugLog(@"[saveWeatherInfo] nsnIdx: %@", nsnIdx);
    
    NSMutableDictionary* nsdTmpDict = [NSMutableDictionary dictionaryWithObjectsAndKeys:
                                       nsnIdx, @"index",
                                       @"", @"weatherData",
                                       nil];
    if(dict == nil)
    {
        DebugLog(@"dict is null!!!");
        return;
    }
    
    [nsdTmpDict setObject:dict forKey:@"weatherData"];
    if(nsdTmpDict == nil)
    {
        DebugLog(@"nsdTmpDict is null!!!");
        return;
    }
    
    DebugLog(@"[saveWeatherInfo] count : %ld, idx : %d ", (long)[mWeatherDataList count], mCurrentCityIdx);
    if([mWeatherDataList count] > 0)
    {
        DebugLog(@"%d update !!!", mCurrentCityIdx);
        [mWeatherDataList setObject:nsdTmpDict atIndexedSubscript:mCurrentCityIdx];
    }
    
    // city list array consisted of dictionary make
    NSMutableDictionary* nsdCityListsDict = [NSMutableDictionary dictionaryWithObjectsAndKeys:
                                       mWeatherDataList, @"weatherDataList",
                                       nil];
    
    NSData *nsdWeatherList = [NSJSONSerialization dataWithJSONObject:nsdCityListsDict options:0 error:&error];
    
    NSString* nssWeatherList = [[NSString alloc] initWithData:nsdWeatherList encoding:NSUTF8StringEncoding];
    if(nssWeatherList == nil)
    {
        DebugLog(@"nssCityList is null!!!");
        return;
    }
    [sharedUserDefaults setObject:nssWeatherList forKey:@"weatherDataList"];
    [sharedUserDefaults synchronize];
    
    //DebugLog(@"nssWeatherList : %@", nssWeatherList);
}

/********************************************************************
 *
 * Name			: updateCurCityInfo
 * Description	: update current city information
 * Returns		: void
 * Side effects :
 * Date			: 2017. 03. 13
 * Author		: SeanKim
 * History		: 20170313 SeanKim Create function
 *
 ********************************************************************/
- (void) updateCurCityInfo:nssName address:nssAddress country:nssCountryName
{
    NSMutableDictionary* nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
    
    NSNumber    *nsnIdx                 = [NSNumber numberWithInteger:mCurrentCityIdx];
    NSDictionary        *nsdLocation    = [nsdCurCity objectForKey:@"location"];
    
    NSMutableDictionary* nsdTmpDict = [NSMutableDictionary dictionaryWithObjectsAndKeys:
                                       nssAddress, @"address",
                                       [nsdCurCity valueForKey:@"currentPosition"], @"currentPosition",
                                       nssCountryName, @"country",
                                       nsnIdx, @"index",
                                       nsdLocation, @"location",
                                       nssName, @"name",
                                       nil];
    DebugLog(@"[updateCurCityInfo] nssAddress :%@", nssAddress);
    [mCityDictList setObject:nsdTmpDict atIndexedSubscript:mCurrentCityIdx];
    
    [todayWSM setCurCountry:nssCountryName];
}

/********************************************************************
 *
 * Name			: updateCurLocation
 * Description	: update current location
 * Returns		: void
 * Side effects :
 * Date			: 2017. 03. 13
 * Author		: SeanKim
 * History		: 20170313 SeanKim Create function
 *
 ********************************************************************/
- (void) updateCurLocation:(NSDictionary *)nsdLocation
{
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair"];
    NSError *error = nil;
    
    NSMutableDictionary* nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
    //DebugLog(@"[updateCurLocation] before nsdCurCity : %@", nsdCurCity);
    
    
    NSNumber    *nsnIdx                 = [NSNumber numberWithInteger:mCurrentCityIdx];
    NSString    *nssAddress             = [nsdCurCity objectForKey:@"address"];
    NSString    *nssCountryName         = [nsdCurCity objectForKey:@"country"];
    NSString    *nssName                = [nsdCurCity objectForKey:@"name"];
    
    NSMutableDictionary* nsdTmpDict = [NSMutableDictionary dictionaryWithObjectsAndKeys:
                                       nssAddress, @"address",
                                       [nsdCurCity valueForKey:@"currentPosition"], @"currentPosition",
                                       nssCountryName, @"country",
                                       nsnIdx, @"index",
                                       nsdLocation, @"location",
                                       nssName, @"name",
                                       nil];
    [mCityDictList setObject:nsdTmpDict atIndexedSubscript:mCurrentCityIdx];
    
    CityInfo *city = [[CityInfo alloc] init];
    city.currentPosition = [nsdTmpDict[@"currentPosition"] boolValue];
    city.address = nsdTmpDict[@"address"];
    city.name = nsdTmpDict[@"name"];
    city.index = [nsdTmpDict[@"index"] intValue];
    city.country = nsdTmpDict[@"country"];
    city.location = nsdTmpDict[@"location"];
    [mCityList setObject:city atIndexedSubscript:mCurrentCityIdx];
    
    //nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
    //DebugLog(@"[updateCurLocation] after nsdCurCity : %@", nsdCurCity);
    
    NSMutableDictionary* nsdCityListsDict = [NSMutableDictionary dictionaryWithObjectsAndKeys:
                                             mCityDictList, @"cityList",
                                             nil];
    
    NSData *nsdCityList = [NSJSONSerialization dataWithJSONObject:nsdCityListsDict options:0 error:&error];
    
    NSString* nssCityList = [[NSString alloc] initWithData:nsdCityList encoding:NSUTF8StringEncoding];
    if(nssCityList == nil)
    {
        DebugLog(@"nssCityList is null!!!");
        return;
    }
    
    DebugLog(@"[updateCurLocation] nssCityList : %@", nssCityList);
    [sharedUserDefaults setObject:nssCityList forKey:@"cityList"];
    [sharedUserDefaults synchronize];
}

/********************************************************************
 *
 * Name			: processRequestIndicator
 * Description	: process request indication
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 02
 * Author		: SeanKim
 * History		: 20161102 SeanKim Create function
 *
 ********************************************************************/
- (void) processRequestIndicator:(BOOL)isComplete
{
    if(isComplete == TRUE)
    {
        bIsReqComplete = TRUE;
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [loadingIV stopAnimating];
            loadingIV.hidden = TRUE;
        });
        
    }
    else    // False
    {
        bIsReqComplete = FALSE;
        dispatch_async(dispatch_get_main_queue(), ^{
            [loadingIV startAnimating];
            loadingIV.hidden = FALSE;
        });
    }
}

/********************************************************************
 *
 * Name			: userDefaultsDidChange
 * Description	: process when user defaults is changed
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 23
 * Author		: SeanKim
 * History		: 20160623 SeanKim Create function
 *
 ********************************************************************/
- (void) userDefaultsDidChange:(NSNotification *)notification
{
    NSString *nssAddr1 = nil;
    NSString *nssAddr2 = nil;
    NSString *nssAddr3 = nil;
    NSString *nssReqURL = nil;
    
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair"];
    
    DebugLog(@"userDefaultsDidChange Enter");
    
    nssAddr1 = [sharedUserDefaults objectForKey:@"addr1"];
    nssAddr2 = [sharedUserDefaults objectForKey:@"addr2"];
    nssAddr3 = [sharedUserDefaults objectForKey:@"addr3"];
    
    nssReqURL = [self makeRequestURL:nssAddr1 addr2:nssAddr2 addr3:nssAddr3 country:@"KR"];
    
    [self requestAsyncByURLSession:nssReqURL reqType:TYPE_REQUEST_WEATHER_KR];
    
    DebugLog(@"userDefaultsDidChange Leave");
}

/********************************************************************
 *
 * Name			: didReceiveMemoryWarning
 * Description	: process when did receive memory warning
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 23
 * Author		: SeanKim
 * History		: 20160623 SeanKim Create function
 *
 ********************************************************************/
- (void)didReceiveMemoryWarning {
    [super didReceiveMemoryWarning];
    // Dispose of any resources that can be recreated.
}

/********************************************************************
 *
 * Name			: widgetPerformUpdateWithCompletionHandler
 * Description	: widgetPerformUpdateWithCompletionHandler callback function
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 22
 * Author		: SeanKim
 * History		: 20160622 SeanKim Create function
 *
 ********************************************************************/
- (void)widgetPerformUpdateWithCompletionHandler:(void (^)(NCUpdateResult))completionHandler {
    // Perform any setup necessary in order to update the view.
    
    // If an error is encountered, use NCUpdateResultFailed
    // If there's no update required, use NCUpdateResultNoData
    // If there's an update, use NCUpdateResultNewData

    completionHandler(NCUpdateResultNewData);
}

/********************************************************************
 *
 * Name			: editWidget
 * Description	: process button action for editing Widget
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 23
 * Author		: SeanKim
 * History		: 20160623 SeanKim Create function
 *
 ********************************************************************/
- (IBAction) editWidget:(id)sender
{
    NSURL *pjURL = [NSURL URLWithString:@"todayair://"];
    DebugLog(@"pjURL : %@", pjURL);
    [self.extensionContext openURL:pjURL completionHandler:^(BOOL success) {
        DebugLog(@"fun=%s after completion. success=%d", __func__, success);
    }];
    //[self.extensionContext openURL:pjURL completionHandler:nil];
}

/********************************************************************
 *
 * Name			: updateData
 * Description	: update All Datas
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (IBAction) updateData:(id)sender
{
    [self refreshDatas];
}

/********************************************************************
 *
 * Name			: toggleShowMore
 * Description	: process between showMore and compact
 * Returns		: IBAction
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (IBAction)toggleShowMore:(id)sender
{
    NSDictionary *curDict   = [self getCurJsonDict];
    NSString *nssCountry = [todayWSM getCurCountry];//[curDict objectForKey:@"country"];
    
    //DebugLog(@"curDict : %@, nssCountry : %@", curDict, nssCountry);
    DebugLog(@"nssCountry : %@", nssCountry);
    
    dispatch_async(dispatch_get_main_queue(), ^{
        if(bIsDateView == true)
        {
            DebugLog(@"processByTimeData is excute!!!");
            if([nssCountry isEqualToString:@"KR"] || nssCountry == nil )
                [todayWSM processByTimeData:curDict type:TYPE_REQUEST_WEATHER_KR];
            else
                [todayWSM processByTimeData:curDict type:TYPE_REQUEST_WEATHER_GLOBAL];
            
            bIsDateView = false;
        }
        else
        {
            DebugLog(@"processDailyData is excute!!!");
            if([nssCountry isEqualToString:@"KR"] || nssCountry == nil )
                [todayWSM processDailyData:curDict type:TYPE_REQUEST_WEATHER_KR];
            else
                [todayWSM processDailyData:curDict type:TYPE_REQUEST_WEATHER_GLOBAL];
            
            bIsDateView = true;
        }
    });
}

/********************************************************************
 *
 * Name			: moveMainApp
 * Description	: move to main application
 * Returns		: IBAction
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (IBAction)moveMainApp:(id)sender;
{
    DebugLog(@"move Main Appication!!!");
    NSString *nssURL = [NSString stringWithFormat:@"todayair://%d", mCurrentCity.appIndex];
    
    DebugLog(@"mCurrentCity.index : %d", mCurrentCity.appIndex);
    
    NSURL *pjURL = [NSURL URLWithString:nssURL];
    DebugLog(@"pjURL : %@", pjURL);
    
    [self.extensionContext openURL:pjURL completionHandler:nil];
}

/********************************************************************
 *
 * Name			: getCurJsonDict
 * Description	: get current JSON dictionary
 * Returns		: NSDictionary *
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (NSMutableDictionary *) getCurJsonDict
{
    return curJsonDict;
}

/********************************************************************
 *
 * Name			: setCurJsonDict
 * Description	: set current JSON dictionary
 * Returns		: void
 * Side effects :
 * Date			: 2016. 12. 29
 * Author		: SeanKim
 * History		: 20161229 SeanKim Create function
 *
 ********************************************************************/
- (void) setCurJsonDict:(NSDictionary *)dict
{
    if(curJsonDict == nil)
    {
        curJsonDict = [[NSMutableDictionary alloc] initWithDictionary:dict];
    }
    else
    {
        [curJsonDict setDictionary:dict];
    }
}

/********************************************************************
 *
 * Name			: nextCity
 * Description	: process next city information
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (IBAction)nextCity:(id)sender {
    //nextCity
    CityInfo *nextCity = nil;
    DebugLog(@"[nextCity] index+1 : %d, mCityList count : %ld ", mCurrentCity.index+1, [mCityList count]);
    if (mCurrentCity.index+1 >= [mCityList count]) {
        nextCity = mCityList.firstObject;
        DebugLog(@"next city is firstObject");
    }
    else {
        nextCity = mCityList[mCurrentCity.index+1];
        DebugLog(@"next city is %d,", mCurrentCity.index+1);
    }
    [self setCityInfo:nextCity];
}

/********************************************************************
 *
 * Name			: refreshDatas
 * Description	: update All Datas
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) refreshDatas
{
    [self initLocationInfo];
}

/********************************************************************
 *
 * Name			: getAddressFromGoogle
 * Description	: get Address data from Google
 * Returns		: void
 * Side effects :
 * Date			: 2017. 03. 04
 * Author		: SeanKim
 * History		: 20170304 SeanKim Create function
 *
 ********************************************************************/
- (void) getAddressFromGoogle:(float)latitude longitude:(float)longitude
{
    //40.7127837, -74.0059413 <- New York
    
#if 0 //GLOBAL_TEST
    // FIXME - for emulator - delete me
    float lat = 40.7127837;
    float longi = -74.0059413;
    
    // 오사카
    //float lat = 34.678395;
    //float longi = 135.4601303;
    
    //https://maps.googleapis.com/maps/api/geocode/json?latlng=40.7127837,-74.0059413
    
    NSString *nssURL = [NSString stringWithFormat:@"%@%f,%f", STR_GOOGLE_COORD2ADDR_URL, lat, longi];
#else
    NSString *nssURL = [NSString stringWithFormat:@"%@%f,%f", STR_GOOGLE_COORD2ADDR_URL, latitude, longitude];
#endif
    
    DebugLog(@"[getAddressFromGoogle]url : %@", nssURL);
    
    [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_ADDR_GOOGLE];
}

/********************************************************************
 *
 * Name			: getAddressFromGoogle
 * Description	: get Address data from Google
 * Returns		: void
 * Side effects :
 * Date			: 2017. 03. 04
 * Author		: SeanKim
 * History		: 20170304 SeanKim Create function
 *
 ********************************************************************/
- (void) getGeocodeFromGoogle:(NSString *)nssAddress
{
    //https://maps.googleapis.com/maps/api/geocode/json?address=
    
    NSCharacterSet *set = [NSCharacterSet URLHostAllowedCharacterSet];
    NSString *nssEncAddress = [nssAddress stringByAddingPercentEncodingWithAllowedCharacters:set];
 
    NSString *nssURL = [NSString stringWithFormat:@"%@%@", STR_GOOGLE_ADDR2COORD_URL, nssEncAddress];
    DebugLog(@"[getGeocodeFromGoogle] nssAddress : %@", nssAddress);
    DebugLog(@"[getGeocodeFromGoogle] nssEncAddress : %@", nssEncAddress);
    DebugLog(@"[getGeocodeFromGoogle] url : %@", nssURL);
    
    [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_GEO_GOOGLE];
}

/********************************************************************
 *
 * Name			: requestAsyncByURLSession
 * Description	: request Async using URL Sesion
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) requestAsyncByURLSession:(NSString *)nssURL reqType:(NSUInteger)type
{
    NSURL *url = [NSURL URLWithString:nssURL];
    
    DebugLog(@"[requestAsyncByURLSession] url : %@, type : %lu", url, (unsigned long)type);
#if 0
    NSURLSessionTask *task = [[NSURLSession sharedSession] dataTaskWithURL:url
                                                         completionHandler:
                              ^(NSData *data, NSURLResponse *response, NSError *error) {
                                  if (data) {
                                      // Do stuff with the data
                                      //DebugLog(@"data : %@", data);
                                      [self makeJSONWithData:data reqType:type];
                                  } else {
                                      DebugLog(@"Failed to fetch %@: %@", url, error);
                                  }
                              }];
    
    [task resume];
#else
    NSMutableURLRequest *request = [[NSMutableURLRequest alloc] initWithURL:url];
    
//    if(type == TYPE_REQUEST_WEATHER_KR)
//    {
//        //[request setValue:@"ko-kr,ko;q=0.8,en-us;q=0.5,en;q=0.3" forHTTPHeaderField:@"Accept-Language"];
//        [request setValue:@"ko-KR,ko;q=0.8,en-US;q=0.6,en;q=0.4" forHTTPHeaderField:@"Accept-Language"];
//
//        DebugLog(@"[requestAsyncByURLSession] Accept-Language : ko-KR,ko;q=0.8,en-US;q=0.6,en;q=0.4");
//    }

    NSURLSessionTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
                                                          completionHandler:
                               ^(NSData *data, NSURLResponse *response, NSError *error) {
                                   if (data) {
                                       // Do stuff with the data
                                       //DebugLog(@"data : %@", data);
                                       [self makeJSONWithData:data reqType:type];
                                       //[self processShowMore];
                                       
                                   } else {
                                       DebugLog(@"Failed to fetch %@: %@", url, error);
                                       [self processErrorStatus:error];
                                   }
                               }];
     
     [task resume];
#endif
}

/********************************************************************
 *
 * Name			: makeJSONWithData
 * Description	: make JSON with Data as requesting type
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) makeJSONWithData:(NSData *)jsonData reqType:(NSUInteger)type
{
    if(jsonData == nil)
    {
        DebugLog(@"jsonData is nil");
        return;
    }
    
    NSError *error;
    NSDictionary *jsonDict = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    //DebugLog(@"jsonDict : %@", jsonDict);
    
    if(type == TYPE_REQUEST_ADDR_DAUM)
    {
        [self parseKRAddress:jsonDict];
    }
    else if(type == TYPE_REQUEST_ADDR_GOOGLE)
    {
        [self parseGlobalAddress:jsonDict];
    }
    else if(type == TYPE_REQUEST_GEO_GOOGLE)
    {
        [self parseGlobalGeocode:jsonDict];
    }
    else if(type == TYPE_REQUEST_WEATHER_GLOBAL)
    {
        [self saveWeatherInfo:jsonDict];
        [self processWeatherResultsAboutGlobal:jsonDict];
        [self processRequestIndicator:TRUE];
    }
    else if (type == TYPE_REQUEST_WEATHER_BY_COORD
             || type == TYPE_REQUEST_WEATHER_KR)
    {
        [self saveWeatherInfo:jsonDict];
        [self processWeatherResultsByCoord:jsonDict];
        [self processRequestIndicator:TRUE];
    }
    
    //DebugLog(@"request weather result %@", jsonDict);
}

/********************************************************************
 *
 * Name			: parseKRAddress
 * Description	: parsing Address about KR
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) parseKRAddress:(NSDictionary *)jsonDict
{
    NSDictionary *dict;
    NSString *nssFullName;
    NSString *nssName;
    NSString *nssName0;
    NSString *nssName1;
    NSString *nssName2;
    NSString *nssName3;
    
    NSString *nssURL = nil;
    
    dict = [jsonDict objectForKey:@"error"];
    //DebugLog(@"error dict : %@", dict);
    
    if(dict)
    {
        DebugLog(@"error message : %@", [dict objectForKey:@"message"]);
    }
    else
    {
        DebugLog(@"I am valid json data!!!");
        
        nssFullName = [jsonDict objectForKey:@"fullName"];
        nssName = [jsonDict objectForKey:@"name"];
        nssName0 = [jsonDict objectForKey:@"name0"];
        nssName1 = [jsonDict objectForKey:@"name1"];
        nssName2 = [jsonDict objectForKey:@"name2"];
        nssName3 = [jsonDict objectForKey:@"name3"];
        
        NSString *nssName22 = [nssName2 stringByReplacingOccurrencesOfString:@" " withString:@""];
        
#if USE_DEBUG
        DebugLog(@"nssFullName : %@", nssFullName);
        DebugLog(@"nssName : %@", nssName);
        DebugLog(@"nssName0 : %@", nssName0);
        DebugLog(@"nssName1 : %@", nssName1);
        DebugLog(@"nssName22 : %@", nssName22);
        DebugLog(@"nssName3 : %@", nssName3);
#endif
        nssURL = [self makeRequestURL:nssName1 addr2:nssName22 addr3:nssName3 country:@"KR"];

        [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER_KR];
    }
}

/********************************************************************
 *
 * Name			: parseGlobalAddress
 * Description	: parsing Address about Global
 * Returns		: void
 * Side effects :
 * Date			: 2017. 03. 04
 * Author		: SeanKim
 * History		: 20170304 SeanKim Create function
 *
 ********************************************************************/
- (void) parseGlobalAddress:(NSDictionary *)jsonDict
{
    NSString *nssStatus         = [jsonDict objectForKey:@"status"];
    if(![nssStatus isEqualToString:@"OK"])
    {
        DebugLog(@"nssStaus[%@] is not OK", nssStatus);
        return;
    }
    
    NSArray *arrResults         = [jsonDict objectForKey:@"results"];
    
    NSArray *arrSubLevel2Types  = [[NSArray alloc] initWithObjects:@"political", @"sublocality", @"sublocality_level_2", nil ];
    NSArray *arrSubLevel1Types  = [[NSArray alloc] initWithObjects:@"political", @"sublocality", @"sublocality_level_1", nil ];
    NSArray *arrLocalTypes      = [[NSArray alloc] initWithObjects:@"locality", @"political", nil ];
    NSString *nssCountryTypes   = [NSString stringWithFormat:@"country"];
    
    NSString *nssSubLevel2Name  = nil;
    NSString *nssSubLevel1Name  = nil;
    NSString *nssLocalName      = nil;
    NSString *nssCountryName    = nil;
    
//    NSString *nssURL    = nil;
    
    for (int i=0; i < [arrResults count]; i++)
    {
        NSDictionary *nsdResult = [arrResults objectAtIndex:i];
        if(nsdResult == nil)
        {
            DebugLog(@"nsdResult is null!!!");
            continue;
        }
        
        NSArray      *arrAddressComponents = [nsdResult objectForKey:@"address_components"];
        for (int j=0; j < [arrAddressComponents count]; j++)
        {
            NSString        *nssAddrCompType0    = nil;
            NSString        *nssAddrCompType1    = nil;
            NSString        *nssAddrCompType2    = nil;
            
            NSDictionary    *nsdAddressComponent = [arrAddressComponents objectAtIndex:j];
            NSArray         *arrAddrCompTypes    = [nsdAddressComponent objectForKey:@"types"];
            
            for(int k=0; k < [arrAddrCompTypes count]; k++ )
            {
                if(k == 0)
                    nssAddrCompType0    = [arrAddrCompTypes objectAtIndex:k];
                
                if(k == 1)
                    nssAddrCompType1    = [arrAddrCompTypes objectAtIndex:k];
                
                if(k == 2)
                    nssAddrCompType2    = [arrAddrCompTypes objectAtIndex:k];
            }
            
            if(nssAddrCompType0 == nil)
            {
                nssAddrCompType0 = [NSString stringWithFormat:@"emptyType"];
            }
            
            if(nssAddrCompType1 == nil)
            {
                nssAddrCompType1 = [NSString stringWithFormat:@"emptyType"];
            }
            
            if(nssAddrCompType2 == nil)
            {
                nssAddrCompType2 = [NSString stringWithFormat:@"emptyType"];
            }
            
            if ( [nssAddrCompType0 isEqualToString:[arrSubLevel2Types objectAtIndex:0]]
                && [nssAddrCompType1 isEqualToString:[arrSubLevel2Types objectAtIndex:1]]
                && [nssAddrCompType2 isEqualToString:[arrSubLevel2Types objectAtIndex:2]] )
            {
                nssSubLevel2Name = [NSString stringWithFormat:@"%@", [nsdAddressComponent objectForKey:@"short_name"]];
            }
            
            if ( [nssAddrCompType0 isEqualToString:[arrSubLevel1Types objectAtIndex:0]]
                && [nssAddrCompType1 isEqualToString:[arrSubLevel1Types objectAtIndex:1]]
                && [nssAddrCompType2 isEqualToString:[arrSubLevel1Types objectAtIndex:2]] )
            {
                nssSubLevel1Name = [NSString stringWithFormat:@"%@", [nsdAddressComponent objectForKey:@"short_name"]];
            }
            
            if ( [nssAddrCompType0 isEqualToString:[arrLocalTypes objectAtIndex:0]]
                && [nssAddrCompType1 isEqualToString:[arrLocalTypes objectAtIndex:1]] )
            {
                nssLocalName = [NSString stringWithFormat:@"%@", [nsdAddressComponent objectForKey:@"short_name"]];
            }
            
            if ( [nssAddrCompType0 isEqualToString:nssCountryTypes] )
            {
                nssCountryName = [NSString stringWithFormat:@"%@", [nsdAddressComponent objectForKey:@"short_name"]];
            }
            
            if (nssSubLevel2Name && nssSubLevel1Name && nssLocalName && nssCountryName)
            {
                break;
            }
        }
        
        if (nssSubLevel2Name && nssSubLevel1Name && nssLocalName && nssCountryName)
        {
            break;
        }
    }
    
    NSString *nssName = nil;
    NSString *nssAddress = [NSString stringWithFormat:@""];
    //국내는 동단위까지 표기해야 함.
    if ([nssCountryName isEqualToString:@"KR"])
    {
        if (nssSubLevel2Name)
        {
            nssAddress  = [NSString stringWithFormat:@"%@", nssSubLevel2Name];
            nssName     = [NSString stringWithFormat:@"%@", nssSubLevel2Name];
        }
    }
    
    if (nssSubLevel1Name)
    {
        nssAddress  = [NSString stringWithFormat:@"%@ %@", nssAddress, nssSubLevel1Name];
        if (nssName == nil)
        {
            nssName     = [NSString stringWithFormat:@"%@", nssSubLevel1Name];
        }
    }
    
    if (nssLocalName)
    {
        nssAddress  = [NSString stringWithFormat:@"%@ %@", nssAddress, nssLocalName];
        if (nssName == nil)
        {
            nssName     = [NSString stringWithFormat:@"%@", nssLocalName];
        }
    }
    
    if (nssCountryName)
    {
        nssAddress  = [NSString stringWithFormat:@"%@ %@", nssAddress, nssCountryName];
        if (nssName == nil)
        {
            nssName     = [NSString stringWithFormat:@"%@", nssCountryName];
        }
    }
    
    if (nssName == nil || [nssName isEqualToString:nssCountryName]) {
        DebugLog(@"Fail to find location address");
    }
    
    [self updateCurCityInfo:nssName address:nssAddress country:nssCountryName];

    DebugLog(@"[parseGlobalAddress] Get locations by using name!!! nssAddress : %@", nssAddress);
    [self getGeocodeFromGoogle:nssAddress];
}


/********************************************************************
 *
 * Name			: parseGlobalGeocode
 * Description	: parsing Geocode about Global
 * Returns		: void
 * Side effects :
 * Date			: 2017. 03. 04
 * Author		: SeanKim
 * History		: 20170304 SeanKim Create function
 *
 ********************************************************************/
- (void) parseGlobalGeocode:(NSDictionary *)jsonDict
{
    if(jsonDict == nil)
    {
        DebugLog(@"[parseGlobalGeocode] jsonDict is nil!");
        return;
    }
    
    NSString *nssStatus         = [jsonDict objectForKey:@"status"];
    if(![nssStatus isEqualToString:@"OK"])
    {
        DebugLog(@"nssStaus[%@] is not OK", nssStatus);
        return;
    }

    //DebugLog(@"jsonDict : %@", jsonDict);
    
    NSArray     *arrResults = [jsonDict objectForKey:@"results"];
    if(arrResults == nil)
    {
        DebugLog(@"[parseGlobalGeocode] nsdResults is nil!");
        return;
    }
    
    if([arrResults count] <= 0)
    {
        DebugLog(@"[parseGlobalGeocode] arrResults is 0 or less than 0!!!");
        return;
    }
    
    NSDictionary   *nsdResults  = [arrResults objectAtIndex:0];
    
    //DebugLog(@"nsdResults : %@", nsdResults);
    
    NSDictionary    *nsdGeometry    = [nsdResults objectForKey:@"geometry"];
    if(nsdGeometry == nil)
    {
        DebugLog(@"[parseGlobalGeocode] nsdGeometry is nil!");
        return;
    }
    
    //DebugLog(@"nsdGeometry : %@", nsdGeometry);
    
    NSDictionary    *nsdLocation    = [nsdGeometry  objectForKey:@"location"];
    if(nsdLocation == nil)
    {
        DebugLog(@"[parseGlobalGeocode] nsdLocation is nil!");
        return;
    }
    
    [self updateCurLocation:nsdLocation];
    
    DebugLog(@"nsdLocation : %@", nsdLocation);
    
    [self processGlobalAddress:nsdLocation];
    
}


/********************************************************************
 *
 * Name			: makeRequestURL
 * Description	: make request URL
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (NSString *) makeRequestURL:(NSString *)nssAddr1 addr2:(NSString*)nssAddr2 addr3:(NSString *)nssAddr3 country:(NSString *)country
{
    NSString *nssURL = nil;
    NSCharacterSet *set = nil;
    nssURL = [NSString stringWithFormat:@"%@/%@", TODAYWEATHER_URL, KMA_ADDR_API_URL];
    if (nssAddr1 != nil) {
        nssURL = [NSString stringWithFormat:@"%@/%@", nssURL, nssAddr1];
    }
    if (nssAddr2 != nil) {
        nssURL = [NSString stringWithFormat:@"%@/%@", nssURL, nssAddr2];
    }
    if (nssAddr3 != nil) {
        nssURL = [NSString stringWithFormat:@"%@/%@", nssURL, nssAddr3];
    }
    
#if USE_DEBUG
    DebugLog(@"nssURL %@", nssURL);
#endif
    set = [NSCharacterSet URLQueryAllowedCharacterSet];
    
    nssURL = [nssURL stringByAddingPercentEncodingWithAllowedCharacters:set];
#if USE_DEBUG
    DebugLog(@"after %@", nssURL);
#endif

    return nssURL;
}

/********************************************************************
 *
 * Name			: makeGlobalRequestURL
 * Description	: make Global request URL
 * Returns		: void
 * Side effects :
 * Date			: 2017. 02. 13
 * Author		: SeanKim
 * History		: 20170213 SeanKim Create function
 *
 ********************************************************************/
- (NSString *) makeGlobalRequestURL:(NSDictionary *)nsdLocation
{
    NSString *nssURL = nil;
    NSString *nssLong = nil;
    NSString *nssLat = nil;
    NSString *nssProcessedLat = nil;
    NSString *nssProcessedLong = nil;
    
    if(nsdLocation == nil)
    {
        DebugLog(@"[makeGlobalRequestURL] nsdLocation is nil!!!");
        
        return nil;
    }
    
    //NSString *nssLat = [nsdLocation objectForKey:@"lat"];
    //NSString *nssLong = [nsdLocation objectForKey:@"long"];
    
    NSNumber *nsnLat    = [nsdLocation objectForKey:@"lat"];
    nssLat    = [NSString stringWithFormat:@"%@", nsnLat];
    //DebugLog(@"[makeGlobalRequestURL] nssLat : %@", nssLat);
    NSArray *arrLat     = [nssLat componentsSeparatedByString:@"."];
    NSString *nssLatTmp = [arrLat objectAtIndex:1];
    //DebugLog(@"[makeGlobalRequestURL] nssLatTmp : %@", nssLatTmp);
    
    NSNumber *nsnLong    = [nsdLocation objectForKey:@"long"];
    nssLong    = [NSString stringWithFormat:@"%@", nsnLong];
    
    if(nssLong == nil || [nssLong isEqualToString:@"(null)"])
    {
        nsnLong    = [nsdLocation objectForKey:@"lng"];
        nssLong    = [NSString stringWithFormat:@"%@", nsnLong];
    }
    
    if( [nssLatTmp length] != 2)
    {
        nssProcessedLat   = [TodayWeatherUtil processLocationStr:nssLat];
        nssProcessedLong  = [TodayWeatherUtil processLocationStr:nssLong];
    }
    else
    {
        nssProcessedLat   = [NSString stringWithFormat:@"%@", nssLat];
        nssProcessedLong  = [NSString stringWithFormat:@"%@", nssLong];
    }

    // Ex: https://todayweather.wizardfactory.net/ww/010000/current/2?gcode=40.71,-74.00
    nssURL = [NSString stringWithFormat:@"%@/%@%@,%@", TODAYWEATHER_URL, WORLD_API_URL, nssProcessedLat, nssProcessedLong];
    
    if(nssURL == nil)
    {
        DebugLog(@"nssURL is nil!!!");
        return nil;
    }
    
    return nssURL;
}

/********************************************************************
 *
 * Name			: processWeatherResultsWithShowMore
 * Description	: draw weather request results WithShowMore
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 16
 * Author		: SeanKim
 * History		: 20161116 SeanKim Create function
 *
 ********************************************************************/
- (void) processWeatherResultsWithShowMore:(NSDictionary *)jsonDict
{
    NSDictionary *currentDict = nil;
    NSDictionary *currentArpltnDict = nil;
    NSDictionary *todayDict = nil;
    
    // Date
    NSString        *nssDateTime = nil;
    NSString        *nssTime = nil;
    NSString        *nssLiveTime = nil;
    NSString        *nssHour = nil;
    NSString        *nssMinute = nil;

    // Image
    NSString *nssCurIcon = nil;
    NSString *nssCurImgName = nil;
    NSString *nssTodIcon = nil;
    NSString *nssTodImgName = nil;
    
    // Temperature
    float currentTemp = 0;
    //NSInteger currentHum = 0;
    NSInteger todayMinTemp = 0;
    NSInteger todayMaxTemp = 0;
    
    // Dust
    NSString    *nssAirState = nil;
    NSMutableAttributedString   *nsmasAirState = nil;
    
    // Address
    NSString    *nssCityName = nil;
    NSString    *nssRegionName = nil;
    NSString    *nssTownName = nil;
    NSString    *nssAddress = nil;
    
    // Pop
    NSString    *nssTodPop = nil;
    

    //DebugLog(@"processWeatherResultsWithShowMore : %@", jsonDict);
    if(jsonDict == nil)
    {
        DebugLog(@"jsonDict is nil!!!");
        return;
    }
    [self setCurJsonDict:jsonDict];
    
    // Address
    nssCityName = [jsonDict objectForKey:@"cityName"];
    nssRegionName = [jsonDict objectForKey:@"regionName"];
    nssTownName = [jsonDict objectForKey:@"townName"];
    if([nssTownName length] > 0)
    {
        nssAddress = [NSString stringWithFormat:@"%@", nssTownName];
    }
    else
    {
        if([nssCityName length] > 0)
        {
            nssAddress = [NSString stringWithFormat:@"%@", nssCityName];
        }
        else
        {
            nssAddress = [NSString stringWithFormat:@"%@", nssRegionName];
        }
    }
    

    // Current
    currentDict         = [jsonDict objectForKey:@"current"];
    
    nssCurIcon   = [currentDict objectForKey:@"skyIcon"];
    nssCurImgName = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssCurIcon];
    
    nssLiveTime         = [currentDict objectForKey:@"liveTime"];
    if(nssLiveTime != nil)
        nssTime             = [NSString stringWithFormat:@"%@", nssLiveTime];
    else
        nssTime             = [currentDict objectForKey:@"time"];

    if(nssTime != nil)
    {
        if([nssTime length] >= 2)
        {
            nssHour             = [nssTime substringToIndex:2];
            nssMinute           = [nssTime substringFromIndex:2];
            nssDateTime         = [NSString stringWithFormat:@"%@ %@:%@", LSTR_UPDATE, nssHour, nssMinute];
        }
        else
        {
            nssDateTime             = @"";
        }
    }
    else
    {
        nssDateTime             = @"";
    }
    
    currentArpltnDict   = [currentDict objectForKey:@"arpltn"];
    nssAirState         = [todayWSM getAirState:currentArpltnDict];
//    nssAirIndices       = [        NSArray *arrDate            = [nssTmpDate componentsSeparatedByString:@" "];        // "2017.02.25", "00:00"

    // Test
    //nssAirState = [NSString stringWithFormat:@"통합대기 78 보통"];

    nsmasAirState       = [todayWSM getChangedColorAirState:nssAirState];
    DebugLog(@"[processWeatherResultsWithShowMore] nsmasAirState : %@",nsmasAirState);

    id idT1h    = [NSString stringWithFormat:@"%@", [currentDict valueForKey:@"t1h"]];
    DebugLog(@"[processWeatherResultsWithShowMore] idT1h : %@",idT1h);
    
    if(idT1h)
    {
        currentTemp     = [idT1h floatValue];
    }
    
    TEMP_UNIT tempUnit = [TodayWeatherUtil getTemperatureUnit];
    if(tempUnit == TEMP_UNIT_FAHRENHEIT)
    {
        currentTemp     = (int)[TodayWeatherUtil convertFromCelsToFahr:currentTemp];
    }
    
    //currentHum         = [[currentDict valueForKey:@"reh"] intValue];

    todayDict = [TodayWeatherUtil getTodayDictionary:jsonDict];

    // Today
    nssTodIcon          = [todayDict objectForKey:@"skyIcon"];
    nssTodImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssTodIcon];
    id idTaMin  = [todayDict valueForKey:@"taMin"];
    if(idTaMin)
        todayMinTemp    = [idTaMin intValue];
    
    if(tempUnit == TEMP_UNIT_FAHRENHEIT)
    {
        todayMinTemp     = (int)[TodayWeatherUtil convertFromCelsToFahr:todayMinTemp];
    }
    
    id idTaMax  = [todayDict valueForKey:@"taMax"];
    if(idTaMax)
        todayMaxTemp        = [idTaMax intValue];
    
    if(tempUnit == TEMP_UNIT_FAHRENHEIT)
    {
        todayMaxTemp     = (int)[TodayWeatherUtil convertFromCelsToFahr:todayMaxTemp];
    }

    nssTodPop           = [todayDict objectForKey:@"pop"];
    
    //DebugLog(@"todayMinTemp:%@, todayMaxTemp:%@", [todayDict valueForKey:@"taMin"], [todayDict valueForKey:@"taMax"]);
    //DebugLog(@"todayMinTemp:%ld, todayMaxTemp:%ld", todayMinTemp, todayMaxTemp);
    
    dispatch_async(dispatch_get_main_queue(), ^{
        // Current
        if(nssDateTime)
            updateTimeLabel.text    = nssDateTime;
        
        DebugLog(@"=======>  date : %@", nssDateTime);
        if( (nssAddress == nil) || [nssAddress isEqualToString:@"(null)"])
        {
            addressLabel.text       = @"";
            nextCityBtn.hidden      = true;
        }
        else
        {
            addressLabel.text       = nssAddress;
            nextCityBtn.hidden      = false;
        }
        
        if(nssCurImgName)
        {
            curWTIconIV.image       = [UIImage imageNamed:nssCurImgName];
            curWTIconIV.image = [TodayWeatherUtil renderImageFromView:curWTIconIV withRect:curWTIconIV.bounds transparentInsets:UIEdgeInsetsZero];

        }
        
        if( (idT1h == nil) || [idT1h isEqualToString:@"(null)"] )
        {
           curAirLabel.text       = @"";
        }
        else
        {
            if(tempUnit == TEMP_UNIT_FAHRENHEIT)
            {
                curAirLabel.text       = [NSString stringWithFormat:@"%d˚", (int)currentTemp];
            }
            else
            {
                curAirLabel.text       = [NSString stringWithFormat:@"%.01f˚", currentTemp];
            }
        }
        
        if(nsmasAirState)
            [sumAirLabel setAttributedText:nsmasAirState];
        
        if(nssTodPop)
        {
            int todPop = [nssTodPop intValue]; //todPop = 50;
            if(todPop == 0)
            {
                todayMaxMinTempLabel.text  = [NSString stringWithFormat:@"%ld˚/ %ld˚", (long)todayMinTemp, (long)todayMaxTemp];
            }
            else
            {
                todayMaxMinTempLabel.text  = [NSString stringWithFormat:@"%ld˚/ %ld˚   %@ %d%%", (long)todayMinTemp, (long)todayMaxTemp, LSTR_PROBABILITY_OF_PRECIPITATION, todPop];
            }
        }
        
        locationView.hidden = false;
        //        self.view.hidden = false;
    });
    
    // Draw ShowMore
    [todayWSM           processDailyData:jsonDict type:TYPE_REQUEST_WEATHER_KR];
}

/********************************************************************
 *
 * Name			: processWeatherResultsAboutGlobal
 * Description	: draw weather request results about global
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 16
 * Author		: SeanKim
 * History		: 20161116 SeanKim Create function
 *
 ********************************************************************/
- (void) processWeatherResultsAboutGlobal:(NSDictionary *)jsonDict
{
    NSArray      *thisTimeArr = nil;
    NSDictionary *currentDict = nil;
    NSDictionary *todayDict = nil;
    
    // Date
    NSString        *nssDateTime = nil;
    NSString        *nssTime = nil;
    NSString        *nssHourMin = nil;
    
    // Image∂
    NSString *nssCurIcon = nil;
    NSString *nssCurImgName = nil;
    NSString *nssTodIcon = nil;
    NSString *nssTodImgName = nil;
    
    // Temperature
    float currentTemp = 0;
    int todayMinTemp = 0;
    int todayMaxTemp = 0;
    
    id idT1h    = nil;
    id idTaMin  = nil;
    id idTaMax  = nil;
    
    // Address
    NSString    *nssAddress = nil;
    
    // Pop
    NSString    *nssTodPop = nil;
    
    // Country
    NSString    *nssCountry = nil;
    
    // Temperature Unit
    TEMP_UNIT   tempUnit = TEMP_UNIT_CELSIUS;
    
    //DebugLog(@"processWeatherResultsAboutGlobal : %@", jsonDict);
    if(jsonDict == nil)
    {
        DebugLog(@"jsonDict is nil!!!");
        return;
    }
    
    [self setCurJsonDict:jsonDict];
    
    DebugLog(@"mCurrentCityIdx : %d", mCurrentCityIdx);
    
    NSMutableDictionary* nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
    //DebugLog(@"[processWeatherResultsAboutGlobal] nsdCurCity : %@", nsdCurCity);
    // Address
    nssAddress = [nsdCurCity objectForKey:@"name"];
    nssCountry = [nsdCurCity objectForKey:@"country"];
    if(nssCountry == nil)
    {
        nssCountry = @"KR";
    }
    
    DebugLog(@"[Global]nssAddress : %@, nssCountry : %@", nssAddress, nssCountry);
    
    // Current
    thisTimeArr         = [jsonDict objectForKey:@"thisTime"];

    if([thisTimeArr count] == 2)
        currentDict         = [thisTimeArr objectAtIndex:1];        // Use second index; That is current weahter.
    else
        currentDict         = [thisTimeArr objectAtIndex:0];        // process about thisTime
    
    nssTime             = [currentDict objectForKey:@"date"];
    
    nssCurIcon          = [currentDict objectForKey:@"skyIcon"];
    nssCurImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssCurIcon];

    if(nssTime != nil)
    {
        nssHourMin       = [nssTime substringFromIndex:11];
    }
    else
    {
        nssHourMin       = @"";
    }
    
    DebugLog(@"[Global]nssTime : %@, nssHourMin : %@", nssTime, nssHourMin);
    
    nssDateTime         = [NSString stringWithFormat:@"%@ %@", LSTR_UPDATE, nssHourMin];
    
    // Processing current temperature
    tempUnit = [TodayWeatherUtil getTemperatureUnit];
    if(tempUnit == TEMP_UNIT_FAHRENHEIT)
    {
        idT1h    = [NSString stringWithFormat:@"%@", [currentDict valueForKey:@"temp_f"]];
        if(idT1h)
        {
            currentTemp     = [idT1h intValue];
        }
    }
    else
    {
        idT1h    = [NSString stringWithFormat:@"%@", [currentDict valueForKey:@"temp_c"]];
        if(idT1h)
        {
            currentTemp     = [idT1h floatValue];
        }
    }
    
    //todayDict = [TodayWeatherUtil getTodayDictionary:jsonDict];
    todayDict = [TodayWeatherUtil getTodayDictionaryInGlobal:jsonDict time:nssTime];

    // FIXME
    // PROBABILITY_OF_PRECIPITATION
    nssTodPop           = [todayDict objectForKey:@"precProb"];
    //nssTodPop           = [NSString stringWithFormat:@"50"];
    
    if(tempUnit == TEMP_UNIT_FAHRENHEIT)
    {
        idTaMin  = [todayDict valueForKey:@"tempMin_f"];
        if(idTaMin)
            todayMinTemp    = [idTaMin intValue];
    
        idTaMax  = [todayDict valueForKey:@"tempMax_f"];
        if(idTaMax)
            todayMaxTemp        = [idTaMax intValue];
    }
    else
    {
        idTaMin  = [todayDict valueForKey:@"tempMin_c"];
        if(idTaMin)
            todayMinTemp    = [idTaMin intValue];
        
        idTaMax  = [todayDict valueForKey:@"tempMax_c"];
        if(idTaMax)
            todayMaxTemp        = [idTaMax intValue];
    }

    //DebugLog(@"todayMinTemp:%@, todayMaxTemp:%@", [todayDict valueForKey:@"tempMin_f"], [todayDict valueForKey:@"tempMax_f"]);
    //DebugLog(@"todayMinTemp:%.01f, todayMaxTemp:%.01f", todayMinTemp, todayMaxTemp);
    
    // Today
    nssTodIcon          = [todayDict objectForKey:@"skyIcon"];
    nssTodImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssTodIcon];
    
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self initWidgetViews];
        
        // Current
        if(nssDateTime)
            updateTimeLabel.text    = nssDateTime;
        
        DebugLog(@"=======>  date : %@", nssDateTime);
        if( (nssAddress == nil) || [nssAddress isEqualToString:@"(null)"])
        {
            addressLabel.text       = @"";
            nextCityBtn.hidden      = true;
        }
        else
        {
            addressLabel.text       = nssAddress;
            nextCityBtn.hidden      = false;
        }
        
        if(nssCurImgName)
        {
            curWTIconIV.image       = [UIImage imageNamed:nssCurImgName];
            curWTIconIV.image = [TodayWeatherUtil renderImageFromView:curWTIconIV withRect:curWTIconIV.bounds transparentInsets:UIEdgeInsetsZero];

        }
        
        if( (idT1h == nil) || [idT1h isEqualToString:@"(null)"] )
        {
            curAirLabel.text       = @"";
        }
        else
        {
            if(tempUnit == TEMP_UNIT_FAHRENHEIT)
            {
                curAirLabel.text       = [NSString stringWithFormat:@"%d˚", (int)currentTemp];
            }
            else
            {
                curAirLabel.text       = [NSString stringWithFormat:@"%.01f˚", currentTemp];
            }
        }
        
        todayMaxMinTempLabel.font   = [UIFont systemFontOfSize:18.0];
        
        if(nssTodPop)
        {
            int todPop = [nssTodPop intValue];
            DebugLog(@"todPop : %@ %d", nssTodPop, todPop);
            
            if(todPop == 0)
            {
                sumAirLabel.font           = [UIFont systemFontOfSize:16.0];
                sumAirLabel.text           = [NSString stringWithFormat:@"%@ %d%%", LSTR_PROBABILITY_OF_PRECIPITATION, todPop];
                
                todayMaxMinTempLabel.text  = [NSString stringWithFormat:@"%d˚/ %d˚", todayMinTemp, todayMaxTemp];
            }
            else
            {
                sumAirLabel.font           = [UIFont systemFontOfSize:16.0];
                sumAirLabel.text           = [NSString stringWithFormat:@"%@ %d%%", LSTR_PROBABILITY_OF_PRECIPITATION, todPop];
                
                todayMaxMinTempLabel.font   = [UIFont systemFontOfSize:16.0];
                todayMaxMinTempLabel.text   = [NSString stringWithFormat:@"%d˚/ %d˚", todayMinTemp, todayMaxTemp];
            }
        }
        else
        {
            int todPop = 0;
            
            sumAirLabel.font           = [UIFont systemFontOfSize:16.0];
            sumAirLabel.text           = [NSString stringWithFormat:@"%@ %d%%", LSTR_PROBABILITY_OF_PRECIPITATION, todPop];

            todayMaxMinTempLabel.text = [NSString stringWithFormat:@"%d˚/%d˚", todayMinTemp, todayMaxTemp];
        }
        
        locationView.hidden = false;
        //        self.view.hidden = false;
    });
    
    // Draw ShowMore
    [todayWSM           processDailyData:jsonDict type:TYPE_REQUEST_WEATHER_GLOBAL];
}


/********************************************************************
 *
 * Name			: widgetMarginInsetsForProposedMarginInsets
 * Description	: change margin
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (UIEdgeInsets)widgetMarginInsetsForProposedMarginInsets:(UIEdgeInsets)defaultMarginInsets
{
    return UIEdgeInsetsZero;
}

/********************************************************************
 *
 * Name			: connection
 * Description	: didReceiveResponse
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void)connection:(NSURLConnection *)connection didReceiveResponse:(NSURLResponse *)response
{
    responseData = [[NSMutableData alloc] init];
}

/********************************************************************
 *
 * Name			: connection
 * Description	: didReceiveData
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void)connection:(NSURLConnection *)connection didReceiveData:(NSData *)data
{
    [responseData appendData:data];
}

/********************************************************************
 *
 * Name			: connection
 * Description	: didFailWithError
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void)connection:(NSURLConnection *)connection didFailWithError:(NSError *)error
{
    //[responseData release];
    //[connection release];
    //[textView setString:@"Unable to fetch data"];
}

/********************************************************************
 *
 * Name			: connectionDidFinishLoading
 * Description	: process when connection did finish loading
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void)connectionDidFinishLoading:(NSURLConnection *)connection
{
    DebugLog(@"Succeeded! Received %lu bytes of data",(unsigned long)[responseData length]);
    NSString *txt = [[NSString alloc] initWithData:responseData encoding:NSASCIIStringEncoding];

    DebugLog(@"txt : %@", txt);
}

/********************************************************************
 *
 * Name			: initLocationInfo
 * Description	: Init Location Infomation
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) initLocationInfo
{
    if(locationManager == nil)
    {
        locationManager = [[CLLocationManager	alloc]	init];
    }
    
    locationManager.delegate = self;
    locationManager.desiredAccuracy = kCLLocationAccuracyBest;
    
    // Update if you move 200 meter
    locationManager.distanceFilter = 200;
    [locationManager startUpdatingLocation];
}

/********************************************************************
 *
 * Name			: locationManager:didUpdateToLocation:fromLocation
 * Description	: get newLocation and oldLocation
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) locationManager:(CLLocationManager *)manager
     didUpdateToLocation:(CLLocation *)newLocation
            fromLocation:(CLLocation *)oldLocation
{
    NSDate* eventDate = newLocation.timestamp;
    NSTimeInterval	howRecent = [eventDate timeIntervalSinceNow];
    
    if(startingPoint == nil)
        self.startingPoint = newLocation;
    
    if(fabs(howRecent) < 5.0)
    {
        [locationManager stopUpdatingLocation];
        
#if 1 //GLOBAL_TEST
        // FIXME - for emulator - delete me
        //seoul
        //latitude = 37.567;
        //longitude = 126.978;
        
        //New York
        //40.7127837, -74.0059413 <- New York
        
        // 오사카
        //latitude = 34.678395;
        //longitude = 135.4601303;
#endif
        
        gMylatitude		= newLocation.coordinate.latitude;
        gMylongitude	= newLocation.coordinate.longitude;
        
        DebugLog(@"[locationManager] latitude : %.3f, longitude : %.3f",
              newLocation.coordinate.latitude,
              newLocation.coordinate.longitude);
        
        [self getWeatherByCoord:gMylatitude longitude:gMylongitude];
    }
}


/********************************************************************
 *
 * Name			: locationManager:didFailWithError
 * Description	: get Error Value
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) locationManager:(CLLocationManager *)manager
        didFailWithError:(NSError *)error
{
    NSDictionary *curLocDict;
    NSString *errorType;
    
    if(error.code == kCLErrorDenied)
    {
        errorType = @"Access Denied ! If Location Service want to use, Turn on Location Service in Settings";
        
        DebugLog(@"error message : %@", errorType);
    }
    else
    {
        errorType = @"Unknown Error";
        DebugLog(@"error code : %ld", (long)error.code);
        
        // just test - delete me
        //[self getAddressFromDaum:gMylatitude longitude:gMylongitude];
    }

    [self processRequestIndicator:TRUE];
    [locationManager stopUpdatingLocation];
   
    for (NSDictionary *cityDict in mCityDictList) {
        bool curPos = [cityDict[@"currentPosition"] boolValue];
        if(curPos == true)
        {
            curLocDict = [NSDictionary dictionaryWithDictionary:cityDict];
            DebugLog(@"[didFailWithError] Finded (index %d) current postion dictionary!!!", [cityDict[@"currentPosition"] intValue]);
            break;
        }
    }
    NSDictionary *locDict = [curLocDict objectForKey:@"location"];
    float latitude = [[locDict objectForKey:@"lat"] floatValue];
    float longitude = [[locDict objectForKey:@"long"] floatValue];
    
    DebugLog(@"[didFailWithError] lat : %f, long : %f", latitude, longitude);
    
    [self getWeatherByCoord:latitude longitude:longitude];
}

/********************************************************************
 *
 * Name            : processPrevInit
 * Description    : process previous data initialization
 * Returns        : void
 * Side effects :
 * Date            : 2018. 03. 23
 * Author        : SeanKim
 * History        : 20180323 SeanKim Create function
 *
 ********************************************************************/
- (void) processPrevInit:(CityInfo *)nextCity
{
    addressLabel.text       = nextCity.name;
    updateTimeLabel.text    = @"";
    
    curWTIconIV.image       = [UIImage imageNamed:@""];
    curAirLabel.text       = @"";
    sumAirLabel.text       = @"";
    todayMaxMinTempLabel.text   = @"";
    
    time1Label.text         = @"";
    time2Label.text         = @"";
    time3Label.text         = @"";
    time4Label.text         = @"";
    time5Label.text         = @"";
    time6Label.text         = @"";
    
    temp1Label.text         = @"";
    temp2Label.text         = @"";
    temp3Label.text         = @"";
    temp4Label.text         = @"";
    temp5Label.text         = @"";
    temp6Label.text         = @"";
    
    showMore1IV.image       = [UIImage imageNamed:@""];
    showMore2IV.image       = [UIImage imageNamed:@""];
    showMore3IV.image       = [UIImage imageNamed:@""];
    showMore4IV.image       = [UIImage imageNamed:@""];
    showMore5IV.image       = [UIImage imageNamed:@""];
    showMore6IV.image       = [UIImage imageNamed:@""];
}

/********************************************************************
 *
 * Name			: processPrevData
 * Description	: process previous data
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 02
 * Author		: SeanKim
 * History		: 20161102 SeanKim Create function
 *
 ********************************************************************/
- (void) processPrevData:(int)idx
{
    if(mWeatherDataList == nil)
    {
        DebugLog(@"mWeatherDataList is nil");
        return;
    }
    
    if([mWeatherDataList count] <= idx)
    {
        DebugLog(@"idx(%d/%ld) is invalid!!!", idx, [mWeatherDataList count]);
        return;
    }
    
    //DebugLog(@"idx : %d, mWeatherDataList : %@", idx, mWeatherDataList);
    // idx가 count보다 높은 경우는 return함. mWeatherDataList가 null일때도 리턴함. 근본 원인을 밝혀야함
    NSMutableDictionary *nsdWeatherInfo    = [mWeatherDataList objectAtIndex:idx];
    NSMutableDictionary *nsdWeatherData    = [nsdWeatherInfo objectForKey:@"weatherData"];
    //DebugLog(@"nsdWeatherData : %@", nsdWeatherData);
    if( (nsdWeatherData == nil) || ([nsdWeatherData isEqual:@""]) )
    {
        DebugLog(@"nsdWeatherData is NULL!!!");
    }
    else
    {
        [self processWeatherResultsByCoord:nsdWeatherData];
    }
}

/********************************************************************
 *
 * Name			: setCityInfo
 * Description	: set city infomation
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 02
 * Author		: SeanKim
 * History		: 20161102 SeanKim Modified function
 *
 ********************************************************************/
- (BOOL) setCityInfo:(CityInfo *)nextCity
{
    if(bIsReqComplete == FALSE)
    {
        DebugLog(@"[setCity] Still processing...");
        return true;
    }
    
    // Starting Weather Info Request
    bIsReqComplete = FALSE;

    //locationView.hidden = true;
    DebugLog(@"[setCity] index : %d, current position : %@, address : %@ , name : %@, country : %@, location : %@",
        nextCity.index, nextCity.currentPosition?@"true":@"false", nextCity.address, nextCity.name, nextCity.country, nextCity.location);
    
    mCurrentCity = nextCity;
    mCurrentCityIdx = nextCity.index;
    [todayWSM setCurCountry:nextCity.country];
    
    [self processPrevInit:nextCity];
    [self processPrevData:nextCity.index];
    
    [self processRequestIndicator:FALSE];
    
    if (nextCity.currentPosition) {
        [self initLocationInfo];
    }
    else
    {
        float lat = 0;
        float lng = 0;
        
        if (nextCity.location) {
            lat = [[nextCity.location objectForKey:@"lat"] floatValue];
            lng = [[nextCity.location objectForKey:@"long"] floatValue];
        }

#if EMUL_TEST
#else
        lat = 11;
        lng = 11;
#endif
        if (!(lat == 0 && lng == 0)) {
            [self getWeatherByCoord:lat longitude:lng];
        }
        else if([nextCity.country isEqualToString:@"KR"] ||
           [nextCity.country isEqualToString:@"(null)"] ||
           (nextCity.country == nil)
           )
        {
            if (nextCity.address) {
                 [self processKRAddress:nextCity.address];
            }
            else {
                DebugLog(@"Can't load data!! address: %@, location: %@", nextCity.address, nextCity.location);
            }
        }
        else
        {
            DebugLog(@"Can't load data!! address: %@, location: %@", nextCity.address, nextCity.location);
        }
    }
    
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair"];
    NSData *archivedObject = [NSKeyedArchiver archivedDataWithRootObject: nextCity];
    [sharedUserDefaults setObject:archivedObject forKey:@"currentCity"];
    [sharedUserDefaults synchronize];
    DebugLog(@"save first city of list");
    
    return true;
}

- (void) printCurrentAppGroupData
{
    NSError *error;
    NSDictionary *jsonDict;
    NSData *tmpData = nil;
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayair"];
    NSString *cityList = [sharedUserDefaults objectForKey:@"cityList"];
    
    tmpData = [cityList dataUsingEncoding:NSUTF8StringEncoding];
    if(tmpData)
        jsonDict = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpData options:0 error:&error];
    //DebugLog(@"User Default : %@", jsonDict);
    
    for (NSDictionary *cityDict in jsonDict[@"cityList"]) {
        CityInfo *city = [[CityInfo alloc] init];
        city.currentPosition = [cityDict[@"currentPosition"] boolValue];
        city.address = cityDict[@"address"];
        city.index = [cityDict[@"index"] intValue];
        city.name = cityDict[@"name"];
        city.country = cityDict[@"country"];
        city.location = cityDict[@"location"];
        DebugLog(@"[printCurrentAppGroupData]index : %d, current position : %@ address %@, name : %@, country : %@",
              city.index, city.currentPosition?@"true":@"false", city.address, city.name, city.country);
        //DebugLog(@"location : %@", city.location);
        
        //cityData.location = {"lat": coords.latitude, "long": coords.longitude};
        //DebugLog(@"cityDict : %@", cityDict);
    }
}

/********************************************************************
 *
 * Name			: processKRAddress
 * Description	:
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 02
 * Author		: SeanKim
 * History		: 20161102 SeanKim Modified function
 *
 ********************************************************************/
- (void) processKRAddress:(NSString *)nssAddress
{
    NSArray *array = [nssAddress componentsSeparatedByString:@" "];
    NSString *nssAddr1 = nil;
    NSString *nssAddr2 = nil;
    NSString *nssAddr3 = nil;
    NSString *lastChar = nil;
    if ([array count] == 2) {
        nssAddr1 = array[1];
    }
    else if ([array count] == 5) {
        nssAddr1 = array[1];
        nssAddr2 = [NSString stringWithFormat:@"%@%@", array[2], array[3]];
        nssAddr3 = array[4];
        
    }
    else if ([array count] == 4) {
        nssAddr1 = array[1];
        lastChar = [array[3] substringFromIndex:[array[3] length] - 1];
        if ([lastChar isEqualToString:@"구"]) {
            nssAddr2 = [NSString stringWithFormat:@"%@%@", array[2], array[3]];
        }
        else {
            nssAddr2 = array[2];
            nssAddr3 = array[3];
        }
    }
    else if ([array count] == 3) {
        nssAddr1 = array[1];
        lastChar = [array[2] substringFromIndex:[array[2] length] - 1];
        if ([lastChar isEqualToString:@"읍"] || [lastChar isEqualToString:@"면"] || [lastChar isEqualToString:@"동"]) {
            nssAddr2 = array[1];
            nssAddr3 = array[2];
        }
        else {
            nssAddr2 = array[2];
        }
    }
    
    DebugLog(@"Expected string is : %@",array);
    NSString *nssURL = [self makeRequestURL:nssAddr1 addr2:nssAddr2 addr3:nssAddr3 country:@"KR"];
    [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER_KR];
    DebugLog(@"nssURL : %@", nssURL);
}

/********************************************************************
 *
 * Name			: processGlobalAddress
 * Description	:
 * Returns		: void
 * Side effects :
 * Date			: 2016. 11. 02
 * Author		: SeanKim
 * History		: 20161102 SeanKim Modified function
 *
 ********************************************************************/
- (void) processGlobalAddress:(NSDictionary *)nsdLocation
{
    NSString *nssURL = [self makeGlobalRequestURL:nsdLocation];
    
    [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER_GLOBAL];
    
    DebugLog(@"[processGlobalAddress] nssURL : %@", nssURL);
}

- (void) getWeatherByCoord:(float)latitude longitude:(float)longitude
{
    NSDictionary *nssUnits = [todayUtil getUnits];
    //DebugLog(@"[getByCoord] units: %@", nssUnits);
    NSString *nssTempUnits = [nssUnits objectForKey:@"temperatureUnit"];
    NSString *nssWindUnits = [nssUnits objectForKey:@"windSpeedUnit"];
    NSString *nssPressUnits = [nssUnits objectForKey:@"pressureUnit"];
    NSString *nssDistUnits = [nssUnits objectForKey:@"distanceUnit"];
    NSString *nssPrecipUnits = [nssUnits objectForKey:@"precipitationUnit"];
    NSString *nssAirUnits = [nssUnits objectForKey:@"airUnit"];
    
    NSString *nssQueryParams = [NSString stringWithFormat:@"temperatureUnit=%@&windSpeedUnit=%@&pressureUnit=%@&distanceUnit=%@&precipitationUnit=%@&airUnit=%@", nssTempUnits, nssWindUnits, nssPressUnits, nssDistUnits, nssPrecipUnits, nssAirUnits];
#if EMUL_TEST
    NSString *nssURL = [NSString stringWithFormat:@"%@/%@/%.3f,%.3f?%@", TODAYWEATHER_URL, COORD_2_WEATHER_API_URL, latitude, longitude, nssQueryParams];
#else
    NSString *nssURL = [NSString stringWithFormat:@"%@/%@/37.558,127.185?temperatureUnit=C&windSpeedUnit=m/s&pressureUnit=hPa&distanceUnit=km&precipitationUnit=mm&airUnit=airkorea", TODAYWEATHER_URL, COORD_2_WEATHER_API_URL];
#endif
    
    DebugLog(@"[getByCoord] url : %@", nssURL);
    
    [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER_BY_COORD];
}

- (void) processWeatherResultsByCoord:(NSDictionary *)jsonDict
{
    NSArray      *thisTimeArr = nil;
    NSDictionary *currentDict = nil;
    NSDictionary *currentArpltnDict = nil;
    NSDictionary *todayDict = nil;
    
    // Dust
    NSString    *nssAirState = nil;
    NSMutableAttributedString   *nsmasAirState = nil;
    
    // Date
    NSString        *nssDate = nil;
    NSString        *nssDateTime = nil;
    NSString        *nssTime = nil;
    NSString        *nssHourMin = nil;
    
    // Image
    NSString *nssCurIcon = nil;
    NSString *nssCurImgName = nil;
    NSString *nssTodIcon = nil;
    NSString *nssTodImgName = nil;
    
    // Temperature
    float currentTemp = 0;
    int todayMinTemp = 0;
    int todayMaxTemp = 0;
    
    id idT1h    = nil;
    id idTaMin  = nil;
    id idTaMax  = nil;
    
    // Name
    NSString    *nssName = nil;
    
    // Pop
    NSString    *nssTodPop = nil;
    
    // Country
    NSString    *nssCountry = nil;
    
    // Temperature Unit
    TEMP_UNIT   tempUnit = TEMP_UNIT_CELSIUS;
    
    BOOL        currentPosition = FALSE;
    
    //DebugLog(@"ByCoord : %@", jsonDict);
    if(jsonDict == nil)
    {
        DebugLog(@"[ByCoord] jsonDict is nil!!!");
        return;
    }
    [self setCurJsonDict:jsonDict];
    
    DebugLog(@"[ByCoord] current city index=%d, city list count=%ld", mCurrentCityIdx, (unsigned long)[mCityDictList count]);
    
    NSString *nssSource = nil;
    
    nssSource = [jsonDict objectForKey:@"source"];
    
    NSDictionary *rcvUnits = [jsonDict objectForKey:@"units"];
    NSString     *rcvAirUnit = [rcvUnits objectForKey:@"airUnit"];
    DebugLog(@"rcvAirUnit : %@", rcvAirUnit);
    
    NSMutableDictionary* nsdCurCity = nil;
    if (0 <= mCurrentCityIdx && mCurrentCityIdx < [mCityDictList count]) {
        nsdCurCity = [mCityDictList objectAtIndex:mCurrentCityIdx];
        currentPosition = [[nsdCurCity valueForKey:@"currentPosition"] boolValue];
    }
    else {
        DebugLog(@"[ByCoord] current city index is invalid index=%d, city list count=%ld", mCurrentCityIdx, (unsigned long)[mCityDictList count]);
        //use response data for view
        currentPosition = TRUE;
    }
    
    if (currentPosition) {
        nssName         = [jsonDict objectForKey:@"name"];
        nssCountry         = [jsonDict objectForKey:@"country"];
        [todayWSM setCurCountry:nssCountry];
    }
    else {
        //DebugLog(@"[ByCoord] nsdCurCity : %@", nsdCurCity);
        //Name
        nssName = [nsdCurCity objectForKey:@"name"];
        nssCountry = [nsdCurCity objectForKey:@"country"];
        if(nssCountry == nil)
        {
            nssCountry = @"KR";
        }
    }
    
    DebugLog(@"[ByCoord] name : %@, country : %@, source: %@", nssName, nssCountry, nssSource);
    
    // Current
    if([nssSource isEqualToString:@"KMA"]) {
        currentDict         = [jsonDict objectForKey:@"current"];
    }
    else {
        thisTimeArr         = [jsonDict objectForKey:@"thisTime"];
        if([thisTimeArr count] == 0) {
            DebugLog(@"[ByCoord] Fail to load weather data");
            return;
        }
        if([thisTimeArr count] == 2)
            currentDict         = [thisTimeArr objectAtIndex:1];        // Use second index; That is current weahter.
        else
            currentDict         = [thisTimeArr objectAtIndex:0];        // process about thisTime
    }
    
    nssTime         = [currentDict objectForKey:@"stnDateTime"];
    if (nssTime == nil) {
        nssTime             = [currentDict objectForKey:@"dateObj"];
    }
    
    if (nssTime != nil) {
        nssHourMin       = [nssTime substringFromIndex:11];
        DebugLog(@"[ByCoord] nssTime : %@, nssHourMin : %@", nssTime, nssHourMin);
        nssDateTime         = [NSString stringWithFormat:@"%@ %@", LSTR_UPDATE, nssHourMin];
    }
    else {
        //for KMA
        int nTime           = [[currentDict objectForKey:@"time"] intValue];
        nssDateTime         = [NSString stringWithFormat:@"%@ %d:00", LSTR_UPDATE, nTime];
    }
    
    nssDate             = [currentDict objectForKey:@"date"];
    nssCurIcon          = [currentDict objectForKey:@"skyIcon"];
    nssCurImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssCurIcon];
    
    currentArpltnDict   = [currentDict objectForKey:@"arpltn"];
    nssAirState         = [todayWSM getAirState:currentArpltnDict];
    
    nsmasAirState       = [todayWSM getChangedColorAirState:nssAirState];
    
    //DebugLog(@"[ByCoord] nsmasAirState : %@",nsmasAirState);
    
    NSString *nssSummaryAir = [currentDict objectForKey:@"summaryAir"];
    //DebugLog(@"[ByCoord] summaryAir : %@",nssSummaryAir);
    
    unsigned int pm10Value     = [[currentArpltnDict objectForKey:@"pm10Value"] unsignedIntValue];
    unsigned int pm25Value     = [[currentArpltnDict objectForKey:@"pm25Value"] unsignedIntValue];
    float o3Value       = [[currentArpltnDict objectForKey:@"o3Value"] floatValue];

    unsigned int pm10Grade     = [[currentArpltnDict objectForKey:@"pm10Grade"] unsignedIntValue];
    unsigned int pm25Grade     = [[currentArpltnDict objectForKey:@"pm25Grade"] unsignedIntValue];
    unsigned int o3Grade       = [[currentArpltnDict objectForKey:@"o3Grade"] unsignedIntValue];

#if 0
    NSString *nssPM10Str        = [currentArpltnDict objectForKey:@"pm10Str"];
    NSString *nssPM25Str        = [currentArpltnDict objectForKey:@"pm25Str"];
    NSString *nssO3Str        = [currentArpltnDict objectForKey:@"o3Str"];


    //DebugLog(@"[ByCoord] nssPM10Str : %@", nssPM10Str);
    //DebugLog(@"[ByCoord] nssPM25Str : %@", nssPM25Str);
    //DebugLog(@"[ByCoord] nssO3Str : %@", nssO3Str);
    
    UIColor *uicPM10           = [todayWSM getColorAirState:nssPM10Str];
    UIColor *uicPM25           = [todayWSM getColorAirState:nssPM25Str];
    UIColor *uicO3             = [todayWSM getColorAirState:nssO3Str];
#else
    //DebugLog(@"[ByCoord] pm10Grade : %d", pm10Grade);
    //DebugLog(@"[ByCoord] pm25Grade : %d", pm25Grade);
    //DebugLog(@"[ByCoord] o3Grade : %d", o3Grade);
    
    UIColor *uicPM10           = [todayWSM getColorAirStateByGrade:pm10Grade rcvAirUnit:rcvAirUnit];
    UIColor *uicPM25           = [todayWSM getColorAirStateByGrade:pm25Grade rcvAirUnit:rcvAirUnit];
    UIColor *uicO3             = [todayWSM getColorAirStateByGrade:o3Grade rcvAirUnit:rcvAirUnit];

#endif

    // Processing current temperature
    idT1h    = [NSString stringWithFormat:@"%@", [currentDict valueForKey:@"t1h"]];
    if (idT1h) {
        tempUnit = [TodayWeatherUtil getTemperatureUnit];
        if(tempUnit == TEMP_UNIT_FAHRENHEIT) {
            currentTemp     = [idT1h intValue];
        }
        else {
            currentTemp     = [idT1h floatValue];
        }
    }
    
    todayDict = [TodayWeatherUtil getTodayDictionaryByCoord:jsonDict date:nssDate country:nssCountry];
    
    // FIXME
    // PROBABILITY_OF_PRECIPITATION
    nssTodPop           = [todayDict objectForKey:@"pop"];
    //nssTodPop           = [NSString stringWithFormat:@"50"];
    idTaMin  = [todayDict valueForKey:@"tmx"];
    if(idTaMin)
        todayMinTemp    = [idTaMin intValue];
    
    idTaMax  = [todayDict valueForKey:@"tmn"];
    if(idTaMax)
        todayMaxTemp        = [idTaMax intValue];
    
    //DebugLog(@"todayMinTemp:%@, todayMaxTemp:%@", [todayDict valueForKey:@"tmn"], [todayDict valueForKey:@"tmx"]);
    //DebugLog(@"todayMinTemp:%.01f, todayMaxTemp:%.01f", todayMinTemp, todayMaxTemp);
    
    // Today
    nssTodIcon          = [todayDict objectForKey:@"skyIcon"];
    nssTodImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssTodIcon];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self initWidgetViews];
        
        // Current
        if(nssDateTime)
            updateTimeLabel.text    = nssDateTime;
        
        DebugLog(@"[ByCoord] =>  date : %@", nssDateTime);
        
        if( (nssName == nil) || [nssName isEqualToString:@"(null)"])
        {
            if(mCurrentCity.address == nil)
                addressLabel.text       = @"";
            else
                addressLabel.text       = mCurrentCity.address;
        }
        else
        {
            addressLabel.text       = nssName;
        }
        
#if 0
        DebugLog(@"[ByCoord] =>  nssCurImgName : %@", nssCurImgName);
        if(nssCurImgName)
        {
            DebugLog(@"[ByCoord] =>  nssCurImgName : %@", nssCurImgName);
            //curAirIconIV.image       = [UIImage imageNamed:nssCurImgName];
            curAirIconIV.image       = [UIImage imageNamed:@"Moon.png"];
            curAirIconIV.image = [TodayWeatherUtil renderImageFromView:curWTIconIV withRect:curWTIconIV.bounds transparentInsets:UIEdgeInsetsZero];
            
        }
#endif
        
        curAirLabel.numberOfLines = 1;
        sumAirLabel.numberOfLines = 1;
        
#if 0
        if(nsmasAirState)
            [curAirLabel setAttributedText:nsmasAirState];
#else
        NSString *nssAirStatus = [todayWSM.curAirDataDict objectForKey:@"airTitle"];
        curAirLabel.text = [NSString stringWithFormat:@"%@", nssAirStatus];
#endif
        
        if( (nssSummaryAir == nil) || [nssSummaryAir isEqualToString:@"(null)"] )
        {
            sumAirLabel.text       = @"";
        }
        else
        {
            sumAirLabel.text       = [NSString stringWithFormat:@"%@", nssSummaryAir];
        }
        
        pm25Lbl.text                = [NSString stringWithFormat:@"%d", pm25Value];
        pm10Lbl.text                = [NSString stringWithFormat:@"%d", pm10Value];
        o3Lbl.text                  = [NSString stringWithFormat:@"%.3f", o3Value];
        
        
        
        pm25Btn.backgroundColor     = uicPM25;
        pm10Btn.backgroundColor     = uicPM10;
        o3Btn.backgroundColor       = uicO3;
        
        
        locationView.hidden = false;
        //        self.view.hidden = false;
    });
    
#if 0
    // Draw ShowMore
    if([nssSource isEqualToString:@"KMA"]) {
        [todayWSM           processDailyData:jsonDict type:TYPE_REQUEST_WEATHER_KR];
    }
    else {
        [todayWSM           processDailyData:jsonDict type:TYPE_REQUEST_WEATHER_GLOBAL];
    }
#endif
}

- (void) processErrorStatus:(NSError *)error
{
    NSOperatingSystemVersion nsOSVer = [[NSProcessInfo processInfo] operatingSystemVersion];
    DebugLog(@"version : %ld.%ld.%ld", (long)nsOSVer.majorVersion, (long)nsOSVer.minorVersion, (long)nsOSVer.patchVersion);
    
    dispatch_async(dispatch_get_main_queue(), ^{
        NSInteger errCode = error.code;
        updateTimeLabel.text = @"";
        sumAirLabel.text = [NSString stringWithFormat:@"Server Error %ld", (long)errCode];
        todayMaxMinTempLabel.text = @"";
        curAirLabel.text = @"";
        addressLabel.text = @"Error";
        curWTIconIV.image = [UIImage imageNamed:@"empty"];
        
        if(nsOSVer.majorVersion >= 10)
        {
            [self.extensionContext setWidgetLargestAvailableDisplayMode:NCWidgetDisplayModeCompact];
        }
        
        showMoreView.hidden = YES;
        locationView.hidden = false;
    });
}

@end
