package net.wizardfactory.todayweather.widget.JsonElement;

import android.util.Log;

/**
 * Created by aleckim on 2016. 12. 29..
 */

public class GeoInfo {
    private String name;
    private String country;
    private String address;
    double lat;
    double lng;
//    double baseLength;

    public GeoInfo() {
//        baseLength = 0.02;
    }

    public void setName(String locationName) {
       this.name = locationName;
    }

    public String getName() {
        return name;
    }

    public void setCountry(String country) {
        this.country = country;
    }

    public String getCountry() {
        return country;
    }

    public void setAddress(String address) {
        this.address = address;
    }

    public String getAddress() {
        return address;
    }

    public void setLat(double lat) {
        this.lat = lat;
    }

    public double getLat() {
        return lat;
    }

    public void setLng(double lng) {
        this.lng = lng;
    }

    public double getLng() {
        return lng;
    }

    /**
     * 독일어등 소수점표시를 ,로 사용하는 경우가 있어 보임. 주의해야 함.
     * @param val
     * @return
     */
    public double toNormalize(double val) {
        Log.i("GeoInfo", "Val="+val);
        return (double)Math.round(val*100)/100;

//        double normal_val;
//        normal_val = val - (val % this.baseLength) + this.baseLength/2;
//        normal_val = Double.parseDouble(String.format("%.2f",normal_val));
//        return normal_val;
    }
}
