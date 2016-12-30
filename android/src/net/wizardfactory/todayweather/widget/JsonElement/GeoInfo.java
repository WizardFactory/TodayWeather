package net.wizardfactory.todayweather.widget.JsonElement;

/**
 * Created by aleckim on 2016. 12. 29..
 */

public class GeoInfo {
    private String name;
    private String country;
    private String address;
    double lat;
    double lng;

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
}
