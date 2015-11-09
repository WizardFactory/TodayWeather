//
//  InterfaceController.m
//  TodayWeather WatchKit 1 Extension
//
//  Created by neoqmin on 2015. 11. 5..
//
//

#import "InterfaceController.h"


@interface InterfaceController()
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *Temperature;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceImage *weatherImage;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *weatherComment;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *yesterdayMaxTemp;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *yesterdayMinTemp;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *todayMaxTemp;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *todayMinTemp;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *tomorrowMaxTemp;
@property (unsafe_unretained, nonatomic) IBOutlet WKInterfaceLabel *tomorrowMinTemp;
@end


@implementation InterfaceController

- (void)awakeWithContext:(id)context {
    [super awakeWithContext:context];
    
    // Configure interface objects here.
}

- (void)willActivate {
    self.wormhole = [[MMWormhole alloc] initWithApplicationGroupIdentifier:@"group.net.wizardfactory.todayweather"optionalDirectory:nil];
    self.weatherDefaults = [[NSUserDefaults alloc] initWithSuiteName:@"group.net.wizardfactory.todayweather"];
    // This method is called when watch view controller is about to be visible to user
    
    [super willActivate];
    
    NSLog(@"Location : %@", [self.weatherDefaults stringForKey:@"Location"]);
    [self setTitle:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"Location"]]];
    [self.Temperature setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"Temperature"]]];
    [self.weatherComment setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"WeatherComment"]]];
    [self.weatherImage setImageNamed:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"WeatherImage"]]];
    [self.yesterdayMaxTemp setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"YesterdayMaxTemp"]]];
    [self.yesterdayMinTemp setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"YesterdayMinTemp"]]];
    [self.todayMaxTemp setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"TodayMaxTemp"]]];
    [self.todayMinTemp setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"TodayMinTemp"]]];
    [self.tomorrowMaxTemp setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"TomorrowMaxTemp"]]];
    [self.tomorrowMinTemp setText:[NSString stringWithFormat:@"%@", [self.weatherDefaults stringForKey:@"TomorrowMinTemp"]]];
    
    [self.wormhole listenForMessageWithIdentifier:@"UpdateWeather"
                                         listener:^(id messageObject) {
                                             
                                         }];
    [self.wormhole passMessageObject:@"AppLoading" identifier:@"RequestWeather"];
    
    NSLog(@"Send RequestWeatherMessage");
}

- (void)didDeactivate {
    // This method is called when watch view controller is no longer visible
    [super didDeactivate];
}

- (IBAction)sss {
}
@end



