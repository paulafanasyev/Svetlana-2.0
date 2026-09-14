package ru.svetlana.androidruntime;
import android.app.Activity; import android.os.Bundle; import android.content.Intent;
public class MainActivity extends Activity { public void onCreate(Bundle b){ super.onCreate(b); startService(new Intent(this, RuntimeService.class)); } }
