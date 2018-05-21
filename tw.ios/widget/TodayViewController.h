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
#import "TodayWeatherShowMore.h"

/********************************************************************
 Enumration
 ********************************************************************/



@interface CityInfo : NSObject
@property (nonatomic) id identifier;
@property (nonatomic) NSString *address;
@property (nonatomic) BOOL currentPosition;
@property (nonatomic) int index;                       // for drawing data in dictionary
@property (nonatomic) int appIndex;                    // for moving main app
@property (nonatomic) NSString *name;
@property (nonatomic) NSString *country;
@property (nonatomic) NSDictionary *location;
- (void) encodeWithCoder : (NSCoder *)encode ;
- (id) initWithCoder : (NSCoder *)decode;
@end

@class TodayViewController;
@class TodayWeatherShowMore;
@class TodayWeatherUtil;

/********************************************************************
 Declare Class Definitions
 ********************************************************************/
@interface TodayViewController : UIViewController <CLLocationManagerDelegate>
{
    IBOutlet UILabel        *addressLabel;
    IBOutlet UILabel        *updateTimeLabel;
    IBOutlet UIActivityIndicatorView    *loadingIV;
    
    IBOutlet UILabel        *curTempLabel;              // current temperature title
    IBOutlet UILabel        *curDustLabel;            // current Dust

    IBOutlet UIImageView    *curWTIconIV;            // current weather status
    
    IBOutlet UILabel        *todayMaxMinTempLabel;         // today Max/Min Temperature
        
    IBOutlet UIButton       *editWidgetBtn;
    IBOutlet UIButton       *updateDataBtn;
    
    __weak IBOutlet UIView *locationView;
    IBOutlet UIView         *noLocationView;                // No Location View
    IBOutlet UILabel        *descLabel;                     // descLabel
    IBOutlet UIButton       *noLocEditWidgetBtn;
    
    __weak IBOutlet UIButton *nextCityBtn;
    __weak IBOutlet UIButton *twAppBtn;
    __weak IBOutlet UILabel *noLocationLabel;
    

    NSMutableArray          *mCityList;
    NSMutableArray          *mCityDictList;                 // for sealization을 위한
    NSMutableArray          *mWeatherDataList;
    CityInfo                *mCurrentCity;
    int                     mCurrentCityIdx;
    BOOL                    bIsReqComplete;
    
    // current postion
    float								gMylatitude;
    float								gMylongitude;
    
    CLLocationManager					*locationManager;
    CLLocation							*startingPoint;
    
    NSMutableData                       *responseData;
    
    
    BOOL                                bIsDateView;
    __weak IBOutlet UIView *showMoreView;
    
    TodayWeatherShowMore        *todayWSM;
    TodayWeatherUtil            *todayUtil;
    NSMutableDictionary                *curJsonDict;
    
@public
    __weak IBOutlet UILabel *time1Label;
    __weak IBOutlet UILabel *time2Label;
    __weak IBOutlet UILabel *time3Label;
    __weak IBOutlet UILabel *time4Label;
    __weak IBOutlet UILabel *time5Label;
    __weak IBOutlet UILabel *time6Label;
    
    __weak IBOutlet UILabel *temp1Label;
    __weak IBOutlet UILabel *temp2Label;
    __weak IBOutlet UILabel *temp3Label;
    __weak IBOutlet UILabel *temp4Label;
    __weak IBOutlet UILabel *temp5Label;
    __weak IBOutlet UILabel *temp6Label;
    
    __weak IBOutlet UIImageView *showMore1IV;
    __weak IBOutlet UIImageView *showMore2IV;
    __weak IBOutlet UIImageView *showMore3IV;
    __weak IBOutlet UIImageView *showMore4IV;
    __weak IBOutlet UIImageView *showMore5IV;
    __weak IBOutlet UIImageView *showMore6IV;
}

/********************************************************************
 Declare Class properties
 ********************************************************************/
@property (retain, nonatomic) CLLocationManager					*locationManager;
@property (retain, nonatomic) CLLocation						*startingPoint;
@property (retain, nonatomic) NSMutableData						*responseData;
@property (retain, nonatomic) IBOutlet UIActivityIndicatorView    *loadingIV;


/********************************************************************
 Declare Class functions
 ********************************************************************/
+ (TodayViewController *)sharedInstance;

- (IBAction) editWidget:(id)sender;
- (IBAction) updateData:(id)sender;
- (IBAction)toggleShowMore:(id)sender;
- (IBAction)moveMainApp:(id)sender;


- (IBAction)nextCity:(id)sender;

- (void) initWidgetViews;
- (void) initWidgetDatas;
- (void) initLocationInfo;
- (void) refreshDatas;
- (void) getAddressFromGoogle:(float)latitude longitude:(float)longitude;

- (void) requestAsyncByURLSession:(NSString *)nssURL reqType:(NSUInteger)type;

- (void) makeJSONWithData:(NSData *)jsonData reqType:(NSUInteger)type;
- (void) parseKRAddress:(NSDictionary *)jsonDict;
- (void) parseGlobalAddress:(NSDictionary *)jsonDict;
- (void) processWeatherResultsWithShowMore:(NSDictionary *)jsonDict;
- (void) processWeatherResultsAboutGlobal:(NSDictionary *)jsonDict;
- (NSString *) makeRequestURL:(NSString *)nssAddr1 addr2:(NSString*)nssAddr2 addr3:(NSString *)nssAddr3 country:(NSString *)nssCountry;
- (void) processKRAddress:(NSString *)nssAddress;
- (BOOL) setCityInfo:(CityInfo *)nextCity;

- (void) processPrevData:(int)idx;
- (void) processRequestIndicator:(BOOL)isComplete;
- (void) processShowMore;
- (void) processErrorStatus:(NSError *)error;

- (NSMutableDictionary *) getCurJsonDict;
- (void) setCurJsonDict:(NSDictionary *)dict;
- (void) updateCurCityInfo:nssName address:nssAddress country:nssCountryName;
- (void) updateCurLocation:(NSDictionary *)nsdLocation;



@end
