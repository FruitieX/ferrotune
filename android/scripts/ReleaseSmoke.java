import dalvik.system.PathClassLoader;
import java.lang.reflect.*;

public class ReleaseSmoke {
    public static void main(String[] args) throws Exception {
        ClassLoader loader = new PathClassLoader(args[0], ClassLoader.getSystemClassLoader());
        Class<?> api = loader.loadClass(args[1]);
        Class<?> response = loader.loadClass(args[2]);
        Method move = null;
        for (Method method : api.getDeclaredMethods()) {
            if (method.getName().equals(args[3])) move = method;
        }
        if (move == null) throw new AssertionError("Queue move method missing");
        Type[] params = move.getGenericParameterTypes();
        Type continuation = params[params.length - 1];
        if (!(continuation instanceof ParameterizedType)) {
            throw new AssertionError("Suspend continuation lost its generic signature");
        }
        Type result = ((ParameterizedType) continuation).getActualTypeArguments()[0];
        if (result instanceof WildcardType) result = ((WildcardType) result).getLowerBounds()[0];
        if (!result.equals(response)) throw new AssertionError("Queue response became " + result);
        Object serializer = null;
        for (Field field : response.getDeclaredFields()) {
            if (!Modifier.isStatic(field.getModifiers())) continue;
            try {
                Method serializerMethod = field.getType().getDeclaredMethod("serializer");
                field.setAccessible(true);
                serializerMethod.setAccessible(true);
                serializer = serializerMethod.invoke(field.get(null));
            } catch (NoSuchMethodException ignored) { }
        }
        if (serializer == null) throw new AssertionError("Queue response serializer missing");
        System.out.println("PASS: minified queue response signature, runtime serializer");
    }
}
