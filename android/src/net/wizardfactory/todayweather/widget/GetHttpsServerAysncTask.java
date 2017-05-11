package net.wizardfactory.todayweather.widget;

import android.os.AsyncTask;
import android.util.Log;

import java.io.BufferedReader;
import java.io.DataInputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 *  This class http server connect form "GET" Type
 *  Now used for get weather data and location address for geocoder.
 */
public class GetHttpsServerAysncTask extends AsyncTask<String, String, String> {
    private String url = null;

    public GetHttpsServerAysncTask(String url){
        this.url = url;
    }

    @Override
    protected void onPreExecute() {
        // do nothing
        super.onPreExecute();
    }

    @Override
    protected String doInBackground(String... arg0) {
        Log.i("AsyncTask" , "url: " + url);
        return GetWeatherFromHttpsServer(url);
    }

    @Override
    protected void onPostExecute(String jsonStr) {
        // do nothing
    }

    private String GetWeatherFromHttpsServer(String strUrl) {
        String retString = "";
        DataInputStream dis = null;
        StringBuilder messageBuilder = new StringBuilder();
        HttpURLConnection urlConnection = null;
        try {
            URL url = new URL(strUrl);
            urlConnection = (HttpURLConnection) url.openConnection();
            urlConnection.setReadTimeout(3000);
            urlConnection.setConnectTimeout(3000);
            urlConnection.setRequestMethod("GET");
            urlConnection.setDoInput(true);

            BufferedReader bi2 = new BufferedReader( new InputStreamReader( urlConnection.getInputStream(), "UTF-8") );
            String s = "";
            while ((s = bi2.readLine()) != null) {
                retString += s;
            }
        } catch (Exception e) {
            Log.e("AsynTask", e.toString());
            e.printStackTrace();
        } finally {
            if (urlConnection != null) {
                urlConnection.disconnect();
            }
        }

        Log.e("AsyncTask", "ret: " + retString);
        return retString;
    }
}
