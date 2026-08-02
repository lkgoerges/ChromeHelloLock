using System.Text.Json;
using System.Windows.Forms;

namespace ChromeHelloLock.NativeHost;

internal static class Program
{
    [STAThread]
    private static int Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();

        try
        {
            var context = new NativeHostApplicationContext(
                Console.OpenStandardInput(),
                Console.OpenStandardOutput());
            Application.Run(context);
            return 0;
        }
        catch
        {
            // Chrome reports a disconnected native host. Nothing may be written
            // except framed protocol messages because stdout is the transport.
            return 1;
        }
    }
}

internal sealed class NativeHostApplicationContext : ApplicationContext
{
    private readonly Stream input;
    private readonly Stream output;
    private readonly Form ownerWindow;
    private readonly WebAuthnService webAuthn;
    private readonly CancellationTokenSource shutdown = new();

    public NativeHostApplicationContext(Stream input, Stream output)
    {
        this.input = input;
        this.output = output;
        ownerWindow = CreateOwnerWindow();

        // Accessing Handle creates the HWND on this STA thread. Application.Run
        // then supplies the message loop required by desktop WinRT UI.
        _ = ownerWindow.Handle;
        webAuthn = new WebAuthnService(ownerWindow.Handle);
        _ = Task.Run(ReadMessages);
    }

    private static Form CreateOwnerWindow() => new()
    {
        Text = "Chrome Hello Lock",
        FormBorderStyle = FormBorderStyle.FixedToolWindow,
        ShowInTaskbar = false,
        StartPosition = FormStartPosition.Manual,
        Location = new System.Drawing.Point(-32_000, -32_000),
        Size = new System.Drawing.Size(1, 1),
        Opacity = 0,
    };

    private void ReadMessages()
    {
        try
        {
            while (!shutdown.IsCancellationRequested)
            {
                NativeRequest? request = NativeMessageProtocol.Read(input);
                if (request is null) break;

                NativeResponse response = DispatchToUiThread(request).GetAwaiter().GetResult();
                NativeMessageProtocol.Write(output, response);
            }
        }
        catch
        {
            // If a valid request was not available, Chrome will surface the port
            // disconnection. Do not emit unframed diagnostics to stdout.
        }
        finally
        {
            RequestExit();
        }
    }

    private Task<NativeResponse> DispatchToUiThread(NativeRequest request)
    {
        var completion = new TaskCompletionSource<NativeResponse>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        try
        {
            ownerWindow.BeginInvoke((Action)(() =>
            {
                try
                {
                    completion.SetResult(HandleRequestOnUiThread(request));
                }
                catch (Exception exception)
                {
                    completion.SetResult(NativeResponse.Error(
                        request.RequestId,
                        "HostError",
                        exception.Message));
                }
            }));
        }
        catch (Exception exception)
        {
            completion.SetResult(NativeResponse.Error(
                request.RequestId,
                "HostError",
                exception.Message));
        }

        return completion.Task;
    }

    private NativeResponse HandleRequestOnUiThread(NativeRequest request)
    {
        return request.Action switch
        {
            "status" => NativeResponse.Ready(request.RequestId, webAuthn.HasCredential),
            "authenticate" => AuthenticateOnUiThread(request),
            _ => NativeResponse.Error(request.RequestId, "InvalidRequest", "Unknown native host action."),
        };
    }

    private NativeResponse AuthenticateOnUiThread(NativeRequest request)
    {
        WebAuthnResult result = webAuthn.Authenticate();
        return new NativeResponse(
            RequestId: request.RequestId,
            Ok: result.Verified,
            Available: result.Available,
            Verified: result.Verified,
            Availability: webAuthn.HasCredential ? "Ready" : "NeedsEnrollment",
            Result: result.Code,
            Message: result.Message);
    }

    private void RequestExit()
    {
        if (ownerWindow.IsDisposed) return;

        try
        {
            ownerWindow.BeginInvoke((Action)ExitThread);
        }
        catch
        {
            // The UI thread is already shutting down.
        }
    }

    protected override void ExitThreadCore()
    {
        shutdown.Cancel();
        input.Dispose();
        output.Dispose();
        ownerWindow.Dispose();
        shutdown.Dispose();
        base.ExitThreadCore();
    }
}

internal sealed record NativeRequest(string? RequestId, string Action);

internal sealed record NativeResponse(
    string? RequestId,
    bool Ok,
    bool Available,
    bool Verified,
    string Availability,
    string? Result,
    string Message)
{
    public static NativeResponse Ready(string? requestId, bool hasCredential) =>
        new(
            requestId,
            true,
            true,
            false,
            hasCredential ? "Ready" : "NeedsEnrollment",
            null,
            hasCredential
                ? "Windows Hello companion is ready."
                : "Select Test Windows Hello once to create the local Windows Hello credential.");

    public static NativeResponse Error(string? requestId, string result, string message) =>
        new(requestId, false, false, false, "Unknown", result, message);
}

internal static class NativeMessageProtocol
{
    private const int MaximumMessageBytes = 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static NativeRequest? Read(Stream input)
    {
        Span<byte> lengthBytes = stackalloc byte[sizeof(int)];
        int firstByte = input.ReadByte();
        if (firstByte == -1) return null;

        lengthBytes[0] = (byte)firstByte;
        ReadExactly(input, lengthBytes[1..]);

        int length = BitConverter.ToInt32(lengthBytes);
        if (length <= 0 || length > MaximumMessageBytes)
        {
            throw new InvalidDataException("The native message length is invalid.");
        }

        byte[] payload = new byte[length];
        ReadExactly(input, payload);
        return JsonSerializer.Deserialize<NativeRequest>(payload, JsonOptions)
            ?? throw new InvalidDataException("The native message body is invalid.");
    }

    public static void Write(Stream output, NativeResponse response)
    {
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(response, JsonOptions);
        byte[] length = BitConverter.GetBytes(payload.Length);
        output.Write(length);
        output.Write(payload);
        output.Flush();
    }

    private static void ReadExactly(Stream input, Span<byte> buffer)
    {
        int offset = 0;
        while (offset < buffer.Length)
        {
            int read = input.Read(buffer[offset..]);
            if (read == 0) throw new EndOfStreamException("Chrome closed the native message stream.");
            offset += read;
        }
    }
}
