// Test-only UIKit container. No production endpoint or credentials are used.
#import <UIKit/UIKit.h>
#import "TodayViewController.h"
#import "TodayWeatherUtil.h"
#import "TodayWeatherShowMore.h"
@interface TodayViewController (DailyReplay)
- (void)processGlobalAddress:(NSDictionary *)location;
@end
static NSMutableArray *requests, *blocked;
@interface RecordedProtocol : NSURLProtocol @end
@implementation RecordedProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request { return [@[@"http", @"https"] containsObject:request.URL.scheme.lowercaseString]; }
+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request { return request; }
- (void)startLoading {
    NSURL *url=self.request.URL;
    @synchronized(requests) { [requests addObject:url.absoluteString ?: @""]; }
    BOOL allowed=[url.host isEqualToString:@"127.0.0.1"] && url.port.intValue==9 && [url.path isEqualToString:@"/ww/010000/current/2"] && [url.query isEqualToString:@"gcode=51.50,-0.12"];
    if (!allowed) {
        @synchronized(blocked) { [blocked addObject:url.absoluteString ?: @""]; }
        [self.client URLProtocol:self didFailWithError:[NSError errorWithDomain:@"OwnedReplay" code:1 userInfo:nil]]; return;
    }
    NSData *data=[NSData dataWithContentsOfFile:[[NSBundle mainBundle] pathForResource:@"body" ofType:@"json"]];
    NSHTTPURLResponse *response=[[NSHTTPURLResponse alloc] initWithURL:url statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type":@"application/json",@"Cache-Control":@"no-store"}];
    [self.client URLProtocol:self didReceiveResponse:response cacheStoragePolicy:NSURLCacheStorageNotAllowed];
    [self.client URLProtocol:self didLoadData:data]; [self.client URLProtocolDidFinishLoading:self];
}
- (void)stopLoading {}
@end
@interface DailyReplay : UIResponder <UIApplicationDelegate>
@property(nonatomic,strong) UIWindow *window;
@property(nonatomic,strong) TodayViewController *widget;
@property(nonatomic,strong) NSArray *cases;
@property(nonatomic,strong) NSMutableArray *results;
@property(nonatomic,strong) UILabel *title;
@end
@implementation DailyReplay
- (NSArray *)values:(NSString *)prefix suffix:(NSString *)suffix {
    NSMutableArray *values=[NSMutableArray array];
    for (int i=1;i<=6;i++) {
        id view=[self.widget valueForKey:[NSString stringWithFormat:@"%@%d%@",prefix,i,suffix]];
        [values addObject:[view isKindOfClass:UILabel.class] ? ((UILabel *)view).text ?: @"" : @(((UIImageView *)view).image!=nil)];
    }
    return values;
}
- (void)finish {
    BOOL pass=self.results.count>0 && blocked.count==0;
    for (NSDictionary *r in self.results) pass=pass && [r[@"verdict"] isEqual:@"PASS"];
    NSDictionary *receipt=@{@"verdict":pass?@"PASS":@"FAIL",@"results":self.results,@"requests":requests,@"blocked":blocked,@"scope":@"Actual source-built legacy widget objects and storyboard in owned UIKit container; no Springboard Today extension activation"};
    NSString *dir=NSSearchPathForDirectoriesInDomains(NSDocumentDirectory,NSUserDomainMask,YES).firstObject;
    NSString *name=NSProcessInfo.processInfo.environment[@"REPLAY_CASE"] ?: @"all";
    [[NSJSONSerialization dataWithJSONObject:receipt options:NSJSONWritingPrettyPrinted error:nil] writeToFile:[dir stringByAppendingPathComponent:[NSString stringWithFormat:@"receipt-%@.json",name]] atomically:YES];
    NSLog(@"Widget daily replay %@ %@",name,receipt[@"verdict"]);
}
- (void)runCase:(NSUInteger)index {
    if (index>=self.cases.count) { [self finish]; return; }
    NSDictionary *test=self.cases[index];
    NSString *unit=test[@"unit"];
    self.title.text=[NSString stringWithFormat:@"Source-built widget · %@\n%@\nOwned UIKit test container",unit,test[@"id"]];
    [TodayWeatherUtil setTemperatureUnit:[NSString stringWithFormat:@"{\"temperatureUnit\":\"%@\"}",unit]];
    for(int i=1;i<=6;i++) {
        ((UILabel *)[self.widget valueForKey:[NSString stringWithFormat:@"time%dLabel",i]]).text=@"unrendered";
        ((UILabel *)[self.widget valueForKey:[NSString stringWithFormat:@"temp%dLabel",i]]).text=@"unrendered";
        ((UIImageView *)[self.widget valueForKey:[NSString stringWithFormat:@"showMore%dIV",i]]).image=nil;
    }
    NSUInteger before=requests.count;
    TYPE_REQUEST requestType=[test[@"request_type"] isEqual:@"KR"]?TYPE_REQUEST_WEATHER_KR:TYPE_REQUEST_WEATHER_GLOBAL;
    NSUInteger selectedRows=[TodayWeatherUtil getDaysArray:test[@"body"] type:requestType].count;
    __block NSString *caughtException=nil;
    @try {
    if ([test[@"functional"] boolValue]) {
        [self.widget processGlobalAddress:@{@"lat":@51.507,@"long":@(-0.128)}];
    } else {
        TodayWeatherShowMore *more=[self.widget valueForKey:@"todayWSM"];
        [more processDailyData:test[@"body"] type:requestType];
    }
    } @catch (NSException *exception) { caughtException=exception.name; }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,([test[@"functional"] boolValue]?1500:100)*NSEC_PER_MSEC),dispatch_get_main_queue(),^{
        NSArray *temperatures=[self values:@"temp" suffix:@"Label"];
        NSArray *dates=[self values:@"time" suffix:@"Label"];
        NSArray *icons=[self values:@"showMore" suffix:@"IV"];
        NSDictionary *expected=test[@"expected"];
        BOOL pass=caughtException==nil && selectedRows==[expected[@"selected_rows"] unsignedIntegerValue] && [temperatures isEqual:expected[@"temperatures"]] && [dates isEqual:expected[@"dates"]] && ![icons containsObject:@NO];
        NSMutableDictionary *result=[@{@"id":test[@"id"],@"unit":unit,@"dates":dates,@"temperatures":temperatures,@"icons":icons,@"selected_rows":@(selectedRows),@"expected":expected} mutableCopy];
        if ([test[@"functional"] boolValue]) {
            UILabel *current=[self.widget valueForKey:@"curTempLabel"],*daily=[self.widget valueForKey:@"todayMaxMinTempLabel"],*address=[self.widget valueForKey:@"addressLabel"],*update=[self.widget valueForKey:@"updateTimeLabel"];
            UIImageView *icon=[self.widget valueForKey:@"curWTIconIV"];
            BOOL compact=[current.text isEqual:expected[@"current"]] && [daily.text isEqual:expected[@"daily"]] && [address.text isEqual:@"London"] && [update.text containsString:expected[@"time"]] && icon.image!=nil;
            pass=pass && compact && requests.count==before+1 && blocked.count==0;
            result[@"compact"]=@{@"current":current.text?:@"",@"daily":daily.text?:@"",@"address":address.text?:@"",@"update":update.text?:@"",@"icon":@(icon.image!=nil)};
        }
        result[@"exception"]=caughtException?:@"";
        result[@"verdict"]=pass?@"PASS":@"FAIL";
        [self.results addObject:result];
        [self runCase:index+1];
    });
}
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    requests=[NSMutableArray array]; blocked=[NSMutableArray array]; self.results=[NSMutableArray array];
    [NSURLProtocol registerClass:RecordedProtocol.class];
    NSUserDefaults *prefs=[[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayweather"];
    [prefs removePersistentDomainForName:@"group.net.wizardfactory.todayweather"];
    NSDictionary *city=@{@"name":@"London",@"country":@"GB",@"index":@0,@"currentPosition":@NO,@"location":@{@"lat":@0,@"long":@0}};
    NSData *cities=[NSJSONSerialization dataWithJSONObject:@{@"cityList":@[city]} options:0 error:nil];
    [prefs setObject:[[NSString alloc] initWithData:cities encoding:NSUTF8StringEncoding] forKey:@"cityList"];
    [prefs setObject:@"{\"temperatureUnit\":\"C\"}" forKey:@"units"]; [prefs synchronize];
    NSDictionary *fixture=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:[[NSBundle mainBundle] pathForResource:@"cases" ofType:@"json"]] options:0 error:nil];
    NSString *selected=NSProcessInfo.processInfo.environment[@"REPLAY_CASE"];
    NSMutableArray *cases=[NSMutableArray array];
    for(NSDictionary *test in fixture[@"cases"]) if(!selected || [selected isEqual:@"all"] || [test[@"id"] isEqual:selected]) [cases addObject:test];
    self.cases=cases;
    self.window=[[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    UIViewController *host=[UIViewController new]; host.view.backgroundColor=UIColor.whiteColor;
    self.title=[[UILabel alloc] initWithFrame:CGRectMake(20,80,370,85)]; self.title.numberOfLines=3; self.title.textColor=UIColor.blackColor; self.title.font=[UIFont systemFontOfSize:17]; [host.view addSubview:self.title];
    self.widget=(TodayViewController *)[[UIStoryboard storyboardWithName:@"MainInterface" bundle:NSBundle.mainBundle] instantiateInitialViewController];
    [host addChildViewController:self.widget]; self.widget.view.frame=CGRectMake(0,190,self.window.bounds.size.width,400);
    [host.view addSubview:self.widget.view]; [self.widget didMoveToParentViewController:host]; self.window.rootViewController=host; [self.window makeKeyAndVisible];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,500*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self runCase:0];});
    return YES;
}
@end
int main(int argc,char *argv[]) { @autoreleasepool { [[NSUserDefaults standardUserDefaults] setObject:@[@"en"] forKey:@"AppleLanguages"]; return UIApplicationMain(argc,argv,nil,NSStringFromClass(DailyReplay.class)); } }
