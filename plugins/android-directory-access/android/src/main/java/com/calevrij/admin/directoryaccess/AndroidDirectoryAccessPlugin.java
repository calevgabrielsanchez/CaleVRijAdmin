package com.calevrij.admin.directoryaccess;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import androidx.documentfile.provider.DocumentFile;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "AndroidDirectoryAccess")
public class AndroidDirectoryAccessPlugin extends Plugin {
    @PluginMethod
    public void pickDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "directoryPicked");
    }

    @ActivityCallback
    private void directoryPicked(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Folder selection cancelled", "USER_CANCELLED");
            return;
        }
        Uri uri = result.getData().getData();
        int flags = result.getData().getFlags()
                & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            DocumentFile root = DocumentFile.fromTreeUri(getContext(), uri);
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            response.put("name", root == null ? "Carpeta" : root.getName());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not keep access to the selected folder", error);
        }
    }

    @PluginMethod
    public void listDirectory(PluginCall call) {
        try {
            DocumentFile directory = resolveDirectory(call.getString("uri"), call.getString("path", ""), false);
            if (directory == null || !directory.isDirectory()) throw new Exception("Folder not found");
            JSArray entries = new JSArray();
            for (DocumentFile child : directory.listFiles()) {
                JSObject entry = new JSObject();
                entry.put("name", child.getName());
                entry.put("kind", child.isDirectory() ? "directory" : "file");
                entry.put("size", child.length());
                entry.put("lastModified", child.lastModified());
                entry.put("mimeType", child.getType() == null ? "application/octet-stream" : child.getType());
                entries.put(entry);
            }
            JSObject response = new JSObject();
            response.put("entries", entries);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read the selected folder", error);
        }
    }

    @PluginMethod
    public void getDirectory(PluginCall call) {
        try {
            String path = call.getString("path", "");
            DocumentFile directory = resolveDirectory(call.getString("uri"), path, call.getBoolean("create", false));
            if (directory == null) throw new Exception("Folder not found");
            JSObject response = new JSObject();
            response.put("name", directory.getName());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not open the folder", error);
        }
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        try {
            DocumentFile file = resolveFile(call.getString("uri"), call.getString("path"));
            if (file == null || !file.isFile()) throw new Exception("File not found");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = getContext().getContentResolver().openInputStream(file.getUri())) {
                if (input == null) throw new Exception("Could not open file");
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            }
            JSObject response = new JSObject();
            response.put("data", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            response.put("name", file.getName());
            response.put("mimeType", file.getType() == null ? "application/octet-stream" : file.getType());
            response.put("size", bytes.size());
            response.put("lastModified", file.lastModified());
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read the file", error);
        }
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        try {
            String path = call.getString("path");
            String data = call.getString("data");
            String mimeType = call.getString("mimeType", "application/octet-stream");
            if (data == null) throw new Exception("File data is required");
            String[] parts = splitPath(path);
            String fileName = parts[parts.length - 1];
            String parentPath = join(parts, parts.length - 1);
            DocumentFile parent = resolveDirectory(call.getString("uri"), parentPath, true);
            DocumentFile file = parent.findFile(fileName);
            if (file != null && file.isDirectory()) throw new Exception("A folder has the same name");
            if ("application/octet-stream".equals(mimeType)) {
                String extension = MimeTypeMap.getFileExtensionFromUrl(fileName);
                String inferredType = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
                if (inferredType != null) mimeType = inferredType;
            }
            if (file == null) file = parent.createFile(mimeType, fileName);
            if (file == null) throw new Exception("Could not create file");
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            try (OutputStream output = getContext().getContentResolver().openOutputStream(file.getUri(), "wt")) {
                if (output == null) throw new Exception("Could not open file for writing");
                output.write(bytes);
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not write the file", error);
        }
    }

    @PluginMethod
    public void deleteEntry(PluginCall call) {
        try {
            String[] parts = splitPath(call.getString("path"));
            String name = parts[parts.length - 1];
            DocumentFile parent = resolveDirectory(call.getString("uri"), join(parts, parts.length - 1), false);
            DocumentFile entry = parent == null ? null : parent.findFile(name);
            if (entry == null || !entry.delete()) throw new Exception("Could not delete entry");
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not delete the selected entry", error);
        }
    }

    private DocumentFile resolveDirectory(String uri, String path, boolean create) throws Exception {
        DocumentFile current = DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
        if (current == null) throw new Exception("Folder access has expired");
        for (String part : splitPath(path)) {
            if (part.isEmpty()) continue;
            DocumentFile next = current.findFile(part);
            if (next == null && create) next = current.createDirectory(part);
            if (next == null || !next.isDirectory()) throw new Exception("Folder not found: " + part);
            current = next;
        }
        return current;
    }

    private DocumentFile resolveFile(String uri, String path) throws Exception {
        String[] parts = splitPath(path);
        if (parts.length == 0) throw new Exception("Invalid file path");
        DocumentFile parent = resolveDirectory(uri, join(parts, parts.length - 1), false);
        return parent.findFile(parts[parts.length - 1]);
    }

    private String[] splitPath(String path) throws Exception {
        if (path == null || path.isEmpty()) return new String[0];
        String[] parts = path.split("/");
        for (String part : parts) {
            if (part.isEmpty() || part.equals(".") || part.equals("..") || part.contains("\\")) {
                throw new Exception("Invalid file path");
            }
        }
        return parts;
    }

    private String join(String[] parts, int length) {
        StringBuilder path = new StringBuilder();
        for (int index = 0; index < length; index++) {
            if (index > 0) path.append('/');
            path.append(parts[index]);
        }
        return path.toString();
    }
}
