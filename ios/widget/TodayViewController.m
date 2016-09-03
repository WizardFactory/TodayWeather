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

/********************************************************************
 Enumration
 ********************************************************************/
typedef enum
{
    TYPE_REQUEST_NONE,
    TYPE_REQUEST_ADDR,
    TYPE_REQUEST_WEATHER,
    TYPE_REQUEST_MAX,
} TYPE_REQUEST;

/********************************************************************
 Definitions
 ********************************************************************/
#define USE_DEBUG                       0

#define STR_DAUM_COORD2ADDR_URL         @"https://apis.daum.net/local/geo/coord2addr"
#define STR_APIKEY                      @"?apikey="
#define STR_LONGITUDE                   @"&longitude="
#define STR_LATITUDE                    @"&latitude="
#define STR_INPUT_COORD                 @"&inputCoordSystem=WGS84"
#define STR_OUTPUT_JSON                 @"&output=json"
#define API_DAILY_TOWN                  @"v000705/daily/town"

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
}

- (id)initWithCoder:(NSCoder *)coder;
{
    self = [super init];
    if (self != nil)
    {
        _currentPosition = [coder decodeBoolForKey:@"currentPosition"];
        _address = [coder decodeObjectForKey:@"address"];
        _index = [coder decodeIntForKey:@"index"];
    }
    return self;
}
@end

@implementation TodayViewController

@synthesize locationManager;
@synthesize startingPoint;
@synthesize responseData;

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
- (void)viewDidLoad {
    [super viewDidLoad];
    [self setPreferredContentSize:CGSizeMake(self.view.bounds.size.width, 130)];
    // Do any additional setup after loading the view from its nib.
    locationView.hidden = true;
//    self.view.hidden = true;
    
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayweather"];
    
    NSError *error;
    NSDictionary *jsonDict;
    NSData *tmpData = nil;
    
//    NSString *currentWeather = nil;
//    currentWeather = [sharedUserDefaults stringForKey:@"currentWeather"];
//    if (currentWeather) {
//        tmpData = [currentWeather dataUsingEncoding:NSUTF8StringEncoding];
//        jsonDict = [NSJSONSerialization JSONObjectWithData:tmpData options:0 error:&error];
//        //NSLog(@"%@", jsonDict);
//        [self processWeatherResults:jsonDict];
//    }
    
    NSString *cityList = [sharedUserDefaults objectForKey:@"cityList"];
    NSLog(@"cityList : %@", cityList);
    
    if (cityList == nil) {
        //You have to run todayweather for add citylist
        NSLog(@"show no location view");
        noLocationView.hidden = false;
        return;
    }
    else {
        noLocationView.hidden = true;
    }
    
    tmpData = [cityList dataUsingEncoding:NSUTF8StringEncoding];
    jsonDict = [NSJSONSerialization JSONObjectWithData:(NSData*)tmpData options:0 error:&error];
    
    int index = 0;
    mCityList = [NSMutableArray array];
    for (NSDictionary *cityDict in jsonDict[@"cityList"]) {
        CityInfo *city = [[CityInfo alloc] init];
        city.currentPosition = [cityDict[@"currentPosition"] boolValue];
        city.address = cityDict[@"address"];
        city.index = index++;
        NSLog(@"current position %@ address %@", city.currentPosition?@"true":@"false", city.address);
        [mCityList addObject:city];
    }
    
    if ([mCityList count] <= 1) {
        NSLog(@"hide next city btn");
        nextCityBtn.hidden = true;
    }
    
    CityInfo *currentCity = nil;
    NSData *archivedObject = [sharedUserDefaults objectForKey:@"currentCity"];
    currentCity = (CityInfo *)[NSKeyedUnarchiver unarchiveObjectWithData:archivedObject];
    if (currentCity == nil) {
        currentCity = mCityList.firstObject;
    }
    else {
        NSLog(@"load last city info");
    }
    
    [self setCityInfo:currentCity];
    
    //request data
    //if current position is true
    //[self initLocationInfo];
    //else
    //nssURL = [self makeRequestURL:nssName1 addr2:nssName2 addr3:nssName3];
    //[self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER];

//    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(userDefaultsDidChange:) name:NSUserDefaultsDidChangeNotification object:nil];
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
    
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayweather"];
    
    NSLog(@"userDefaultsDidChange Enter");
    
    nssAddr1 = [sharedUserDefaults objectForKey:@"addr1"];
    nssAddr2 = [sharedUserDefaults objectForKey:@"addr2"];
    nssAddr3 = [sharedUserDefaults objectForKey:@"addr3"];
    
    nssReqURL = [self makeRequestURL:nssAddr1 addr2:nssAddr2 addr3:nssAddr3];
    
    [self requestAsyncByURLSession:nssReqURL reqType:TYPE_REQUEST_WEATHER];
    
    NSLog(@"userDefaultsDidChange Leave");
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
    NSURL *pjURL = [NSURL URLWithString:@"todayweather://"];
    [self.extensionContext openURL:pjURL completionHandler:nil];
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

- (IBAction)nextCity:(id)sender {
    //nextCity
    NSLog(@"next city");
    CityInfo *nextCity = nil;
    if (mCurrentCity.index+1 >= [mCityList count]) {
        nextCity = mCityList.firstObject;
    }
    else {
        nextCity = mCityList[mCurrentCity.index+1];
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
 * Name			: getAddressFromDaum
 * Description	: get Address data from daum.
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) getAddressFromDaum:(double)latitude longitude:(double)longitude
{
    // FIXME - for emulator - delete me
    //latitude = 37.574226;
    //longitude = 127.191671;
    
    NSString *nssURL = [NSString stringWithFormat:@"%@%@%@%@%g%@%g%@%@", STR_DAUM_COORD2ADDR_URL, STR_APIKEY, DAUM_SERVICE_KEY, STR_LONGITUDE, longitude, STR_LATITUDE, latitude, STR_INPUT_COORD, STR_OUTPUT_JSON];
    
    //NSLog(@"url : %@", nssURL);
    
    [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_ADDR];
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
  
    NSURLSessionTask *task = [[NSURLSession sharedSession] dataTaskWithURL:url
                                                         completionHandler:
                              ^(NSData *data, NSURLResponse *response, NSError *error) {
                                  if (data) {
                                      // Do stuff with the data
                                      //NSLog(@"data : %@", data);
                                      [self makeJSONWithData:data reqType:type];
                                  } else {
                                      NSLog(@"Failed to fetch %@: %@", url, error);
                                  }
                              }];
    
    [task resume];
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
    NSError *error;
    NSDictionary *jsonDict = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
    //NSLog(@"%@", jsonDict);
    
    if(type == TYPE_REQUEST_ADDR)
    {
        [self parseJSONData:jsonDict];
    }
    else if(type == TYPE_REQUEST_WEATHER)
    {
        [self processWeatherResults:jsonDict];
    }
    
    //NSLog(@"request weather result %@", jsonDict);
}

/********************************************************************
 *
 * Name			: parseJSONData
 * Description	: parsing JSON with Data
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) parseJSONData:(NSDictionary *)jsonDict
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
    //NSLog(@"error dict : %@", dict);
    
    if(dict)
    {
        NSLog(@"error message : %@", [dict objectForKey:@"message"]);
    }
    else
    {
        NSLog(@"I am valid json data!!!");
        
        nssFullName = [jsonDict objectForKey:@"fullName"];
        nssName = [jsonDict objectForKey:@"name"];
        nssName0 = [jsonDict objectForKey:@"name0"];
        nssName1 = [jsonDict objectForKey:@"name1"];
        nssName2 = [jsonDict objectForKey:@"name2"];
        nssName3 = [jsonDict objectForKey:@"name3"];
        
#if USE_DEBUG
        NSLog(@"nssFullName : %@", nssFullName);
        NSLog(@"nssName : %@", nssName);
        NSLog(@"nssName0 : %@", nssName0);
        NSLog(@"nssName1 : %@", nssName1);
        NSLog(@"nssName2 : %@", nssName2);
        NSLog(@"nssName3 : %@", nssName3);
#endif
        nssURL = [self makeRequestURL:nssName1 addr2:nssName2 addr3:nssName3];

        [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER];
    }
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
- (NSString *) makeRequestURL:(NSString *)nssAddr1 addr2:(NSString*)nssAddr2 addr3:(NSString *)nssAddr3
{
    NSString *nssURL = nil;
    NSCharacterSet *set = nil;
    nssURL = [NSString stringWithFormat:@"%@/%@", TODAYWEATHER_URL, API_DAILY_TOWN];
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
    NSLog(@"nssURL %@", nssURL);
#endif
    set = [NSCharacterSet URLQueryAllowedCharacterSet];
    
    nssURL = [nssURL stringByAddingPercentEncodingWithAllowedCharacters:set];
#if USE_DEBUG
    NSLog(@"after %@", nssURL);
#endif

    return nssURL;
}


/********************************************************************
 *
 * Name			: processWeatherResults
 * Description	: draw weather request results
 * Returns		: void
 * Side effects :
 * Date			: 2016. 06. 25
 * Author		: SeanKim
 * History		: 20160625 SeanKim Create function
 *
 ********************************************************************/
- (void) processWeatherResults:(NSDictionary *)jsonDict
{
    NSDictionary *nsdDailySumDict = nil;
    NSDictionary *currentDict = nil;
    NSDictionary *currentArpltnDict = nil;
    NSDictionary *todayDict = nil;
    NSDictionary *tomoDict = nil;
    
    // Date
    NSString    *nssDate = nil;

    // Image
    NSString *nssCurIcon = nil;
    NSString *nssCurImgName = nil;
    NSString *nssTodIcon = nil;
    NSString *nssTodImgName = nil;
    NSString *nssTomIcon = nil;
    NSString *nssTomImgName = nil;

    // Temperature
    NSUInteger currentTemp = 0;
    NSUInteger currentHum = 0;
    NSUInteger todayMinTemp = 0;
    NSUInteger todayMaxTemp = 0;
    NSUInteger tomoMinTemp = 0;
    NSUInteger tomoMaxTemp = 0;
    
    // Dust
    NSString    *nssPm10Str = nil;
    
    // Address
    NSString    *nssCityName = nil;
    NSString    *nssRegionName = nil;
    NSString    *nssTownName = nil;
    NSString    *nssAddress = nil;
    
    // Pop
    NSString    *nssTodPop = nil;
    NSString    *nssTomPop = nil;
    
    NSLog(@"processWeatherResults : %@", jsonDict);
    
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
    
    // Daily Summary
    nsdDailySumDict = [jsonDict objectForKey:@"dailySummary"];
    nssDate     = [nsdDailySumDict objectForKey:@"date"];
    nssCurIcon   = [nsdDailySumDict objectForKey:@"icon"];
    nssCurImgName = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssCurIcon];

    // Current
    currentDict         = [nsdDailySumDict objectForKey:@"current"];
    currentArpltnDict   = [currentDict objectForKey:@"arpltn"];
    nssPm10Str          = [currentArpltnDict objectForKey:@"pm10Str"];
    currentTemp         = [[currentDict valueForKey:@"t1h"] unsignedIntValue];
    currentHum         = [[currentDict valueForKey:@"reh"] unsignedIntValue];
    
    // Today
    todayDict           = [nsdDailySumDict objectForKey:@"today"];
    nssTodIcon          = [todayDict objectForKey:@"skyIcon"];
    nssTodImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssTodIcon];
    todayMinTemp        = [[todayDict valueForKey:@"taMin"] unsignedIntValue];
    todayMaxTemp        = [[todayDict valueForKey:@"taMax"] unsignedIntValue];
    nssTodPop           = [todayDict objectForKey:@"pop"];
    
    // Tomorrow
    tomoDict            = [nsdDailySumDict objectForKey:@"tomorrow"];
    nssTomIcon          = [tomoDict objectForKey:@"skyIcon"];
    nssTomImgName       = [NSString stringWithFormat:@"weatherIcon2-color/%@.png", nssTomIcon];
    tomoMinTemp         = [[tomoDict valueForKey:@"taMin"] unsignedIntValue];
    tomoMaxTemp         = [[tomoDict valueForKey:@"taMax"] unsignedIntValue];
    nssTomPop           = [tomoDict objectForKey:@"pop"];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        // Current
        updateTimeLabel.text    = nssDate;
        addressLabel.text       = nssAddress;
        curWTIconIV.image       = [UIImage imageNamed:nssCurImgName];
        curTempLabel.text       = [NSString stringWithFormat:@"%lu˚ %lu%%", currentTemp, currentHum];
        curDustLabel.text       = [NSString stringWithFormat:@"통합대기 %@", nssPm10Str];
        
        // Today
        todWTIconIV.image       = [UIImage imageNamed:nssTodImgName];
        todayMaxTempLabel.text  = [NSString stringWithFormat:@"%lu˚/%lu˚", todayMaxTemp, todayMinTemp];
        //todayMinTempLabel.text  = [NSString stringWithFormat:@"%lu˚", todayMinTemp];
        todayPopLabel.text      = [NSString stringWithFormat:@"강수확률 %@%%", nssTodPop];
        
        // Tomorrow
        tomoMaxTempLabel.text   = [NSString stringWithFormat:@"%lu˚/%lu˚", tomoMaxTemp, tomoMinTemp];
        //tomoMinTempLabel.text   = [NSString stringWithFormat:@"%lu˚", tomoMinTemp];
        tomoPopLabel.text       = [NSString stringWithFormat:@"강수확률 %@%%", nssTomPop];
        tomWTIconIV.image       = [UIImage imageNamed:nssTomImgName];
        
        locationView.hidden = false;
//        self.view.hidden = false;
    });
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
    NSLog(@"Succeeded! Received %lu bytes of data",(unsigned long)[responseData length]);
    NSString *txt = [[NSString alloc] initWithData:responseData encoding:NSASCIIStringEncoding];

    NSLog(@"txt : %@", txt);
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
    self.locationManager = [[CLLocationManager	alloc]	init];
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
        
        gMylatitude		= newLocation.coordinate.latitude;
        gMylongitude	= newLocation.coordinate.longitude;
        
        NSLog(@"latitude : %g•, longitude : %g•",
              newLocation.coordinate.latitude,
              newLocation.coordinate.longitude);
        
        [self getAddressFromDaum:gMylatitude longitude:gMylongitude];
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
    NSString *errorType;
    
    if(error.code == kCLErrorDenied)
    {
        errorType = @"Access Denied ! If Location Service want to use, Turn on Location Service in Settings";
        
        NSLog(@"error message : %@", errorType);
    }
    else
    {
        errorType = @"Unknown Error";
        NSLog(@"error code : %ld", (long)error.code);
        
        // just test - delete me
        //[self getAddressFromDaum:gMylatitude longitude:gMylongitude];
    }
}

- (BOOL) setCityInfo:(CityInfo *)nextCity {
    locationView.hidden = true;
    NSLog(@"set city : current position %@ address %@ index %d", nextCity.currentPosition?@"true":@"false", nextCity.address, nextCity.index);
    
    mCurrentCity = nextCity;
    if (nextCity.currentPosition) {
        [self initLocationInfo];
    }
    else {
        NSArray *array = [nextCity.address componentsSeparatedByString:@" "];
        NSString *nssAddr1 = nil;
        NSString *nssAddr2 = nil;
        NSString *nssAddr3 = nil;
        if ([array count] > 1) {
            nssAddr1 = array[1];
        }
        if ([array count] > 2) {
            nssAddr2 = array[2];
        }
        if ([array count] > 3) {
            nssAddr2 = array[3];
        }
        
        NSLog(@"Expected string is : %@",array);
        NSString *nssURL = [self makeRequestURL:nssAddr1 addr2:nssAddr2 addr3:nssAddr3];
        [self requestAsyncByURLSession:nssURL reqType:TYPE_REQUEST_WEATHER];
    }
    
    NSUserDefaults *sharedUserDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayweather"];
    NSData *archivedObject = [NSKeyedArchiver archivedDataWithRootObject: nextCity];
    [sharedUserDefaults setObject:archivedObject forKey:@"currentCity"];
    [sharedUserDefaults synchronize];
    NSLog(@"save first city of list");
    return true;
}

@end
