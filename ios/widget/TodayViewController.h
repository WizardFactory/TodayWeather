//
//  TodayViewController.h
//  widget
//
//  Created by KwangHo Kim on 2016. 5. 28..
//
//

/********************************************************************
 Declare include files
 ********************************************************************/
#import <UIKit/UIKit.h>

#import	<CoreLocation/CoreLocation.h>

@interface CityInfo : NSObject
@property (nonatomic) id identifier;
@property (nonatomic) NSString *address;
@property (nonatomic) BOOL currentPosition;
@property (nonatomic) int index;
- (void) encodeWithCoder : (NSCoder *)encode ;
- (id) initWithCoder : (NSCoder *)decode;
@end

/********************************************************************
 Declare Class Definitions
 ********************************************************************/
@interface TodayViewController : UIViewController <CLLocationManagerDelegate>
{
    IBOutlet UILabel        *addressLabel;
    IBOutlet UILabel        *updateTimeLabel;
    
    IBOutlet UILabel        *curTempLabel;              // current temperature title
    IBOutlet UILabel        *curDustLabel;            // current Dust

    IBOutlet UIImageView    *curWTIconIV;            // current weather status
    IBOutlet UIImageView    *todWTIconIV;            // today weather status
    IBOutlet UIImageView    *tomWTIconIV;            // tomorrow weather status
    
    IBOutlet UILabel        *todayMaxTempLabel;         // today Max Temperature
    IBOutlet UILabel        *todayMinTempLabel;         // today Min Temperature
    IBOutlet UILabel        *todayPopLabel;             // today Pop Temperature
    
    IBOutlet UILabel        *tomoMaxTempLabel;          // tomorrow Max Temperature
    IBOutlet UILabel        *tomoMinTempLabel;          // tomorrow Min Temperature
    IBOutlet UILabel        *tomoPopLabel;              // tomorrow Pop Temperature
    
    IBOutlet UIButton       *editWidgetBtn;
    IBOutlet UIButton       *updateDataBtn;
    
    __weak IBOutlet UIView *locationView;
    IBOutlet UIView         *noLocationView;                // No Location View
    IBOutlet UILabel        *descLabel;                     // descLabel
    IBOutlet UIButton       *noLocEditWidgetBtn;
    
    __weak IBOutlet UIButton *nextCityBtn;

    NSMutableArray                             *mCityList;
    CityInfo                                   *mCurrentCity;
    // current postion
    double								gMylatitude;
    double								gMylongitude;
    
    //BOOL                                gCurrentPostion;
    //NSString                            *firstName;
    //NSString                            *secondName;
    //NSString                            *thirdName;
    
    CLLocationManager						*locationManager;
    CLLocation								*startingPoint;
    
    NSMutableData *responseData;
}

/********************************************************************
 Declare Class properties
 ********************************************************************/
@property (retain, nonatomic) CLLocationManager					*locationManager;
@property (retain, nonatomic) CLLocation						*startingPoint;
@property (retain, nonatomic) NSMutableData						*responseData;

/********************************************************************
 Declare Class functions
 ********************************************************************/
- (IBAction) editWidget:(id)sender;
- (IBAction) updateData:(id)sender;

- (IBAction)nextCity:(id)sender;

- (void) initLocationInfo;
- (void) refreshDatas;
- (void) getAddressFromDaum:(double)latitude longitude:(double)longitude;
- (void) requestAsyncByURLSession:(NSString *)nssURL reqType:(NSUInteger)type;
- (void) makeJSONWithData:(NSData *)jsonData reqType:(NSUInteger)type;
- (void) parseJSONData:(NSDictionary *)jsonDict;
- (void) processWeatherResults:(NSDictionary *)jsonDict;
- (NSString *) makeRequestURL:(NSString *)nssAddr1 addr2:(NSString*)nssAddr2 addr3:(NSString *)nssAddr3;
- (BOOL) setCityInfo:(CityInfo *)nextCity;

@end
