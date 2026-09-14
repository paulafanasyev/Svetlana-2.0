package ru.svetlana.androidruntime;
import android.app.Activity; import android.os.Bundle; import android.content.Intent; import java.io.*; import java.net.*;
public class MainActivity extends Activity {
 static ServerSocket server;
 public void onCreate(Bundle b){super.onCreate(b); Holder.a=this; new Thread(()->serve()).start();}
 static void serve(){try{server=new ServerSocket(8765,20,InetAddress.getByName("127.0.0.1")); while(true) handle(server.accept());}catch(Exception e){}}
 static void handle(Socket s){try{BufferedReader r=new BufferedReader(new InputStreamReader(s.getInputStream())); String line=r.readLine(); if(line==null){s.close();return;} String path=line.split(" ")[1]; while(!(line=r.readLine()).isEmpty()){} String body="{\"success\":true}"; if(path.equals("/health")) body="{\"status\":\"ok\"}"; if(path.equals("/api/system/home")){Intent i=new Intent(Intent.ACTION_MAIN); i.addCategory(Intent.CATEGORY_HOME); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); Holder.a.startActivity(i); body="{\"success\":true,\"action\":\"home\"}";} byte[] b=body.getBytes("UTF-8"); OutputStream o=s.getOutputStream(); o.write(("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "+b.length+"\r\nConnection: close\r\n\r\n").getBytes("UTF-8")); o.write(b); o.flush(); s.close();}catch(Exception e){}}
 static class Holder{static Activity a;}
}
