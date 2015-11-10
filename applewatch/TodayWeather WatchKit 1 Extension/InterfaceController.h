//
//  InterfaceController.h
//  TodayWeather WatchKit 1 Extension
//
//  Created by neoqmin on 2015. 11. 5..
//
//

#import <WatchKit/WatchKit.h>
#import <Foundation/Foundation.h>
#import "MMWormhole.h"

@interface InterfaceController : WKInterfaceController
@property (nonatomic, strong) NSUserDefaults* weatherDefaults;
@end
