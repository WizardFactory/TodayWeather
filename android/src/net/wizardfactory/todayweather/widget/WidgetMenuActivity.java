package net.wizardfactory.todayweather.widget;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;

import net.wizardfactory.todayweather.MainActivity;
import net.wizardfactory.todayweather.R;

import org.apache.cordova.CordovaActivity;

/**
 * This class is menu of widget
 * used common all widget.
 */
public class WidgetMenuActivity extends CordovaActivity {
    private Context mContxt = null;
    int mAppWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID;
    int mLayoutId = -1;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        mContxt = getApplicationContext();

        // Find the widget id from the intent.
        Intent intent = getIntent();
        Bundle extras = intent.getExtras();
        if (extras != null) {
//            mAppWidgetId = extras.getInt(
//                    AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
            mLayoutId = extras.getInt("LAYOUT_ID", -1);
        }

        Log.i("WidgetMenu", "app widget id="+mAppWidgetId);
        setContentView(R.layout.widget_menu);
    }

    @Override
    protected void onResume() {
        super.onResume();

        LinearLayout mainLayout = (LinearLayout)findViewById(R.id.menu_layout);
        mainLayout.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                finish();
            }
        });

        // update widget button
        Button updateBtn = (Button)findViewById(R.id.update_button);
        updateBtn.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                updateWidget();
                finish();
            }
        });

        // move main page button
        Button moveMainBtn = (Button)findViewById(R.id.move_main_button);
        moveMainBtn.setOnClickListener(new View.OnClickListener() {
            public void onClick(View arg0) {
                moveMain();
            }
        });
    }

    private void updateWidget() {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(mContxt);
        Class<?> widgetProvider = WidgetUpdateService.getWidgetProvider(mLayoutId);
        ComponentName thisWidget = new ComponentName(mContxt, widgetProvider);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(thisWidget);

        Intent intent = new Intent(this, widgetProvider);
        intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds);
        intent.putExtra("ManualUpdate", true);
        sendBroadcast(intent);
    }

    private void moveMain() {
        Intent intent = new Intent(mContxt, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        mContxt.startActivity(intent);
        finish();
    }
}
