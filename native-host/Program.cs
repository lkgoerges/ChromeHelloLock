using System.Text.Json;
using System.Windows.Forms;
using Windows.Security.Credentials.UI;

namespace ChromeHelloLock.NativeHost;

internal static class Program
{
    private const string DefaultPrompt = "Unlock your Chrome work profile";

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            using Stream input = Console.OpenStandardInput();
            using Stream output = Console.OpenStandardOutput();

            NativeRequest request = NativeMessageProtocol.Read(input);
            NativeResponse response = HandleRequestAsync(request, args).GetAwaiter().GetResult();
            NativeMessageProtocol.Write(output, response);
            return response.Ok ? 0 : 1;
        }
        catch (Exception exception)
        {
            try
            {
                using Stream output = Console.OpenStandardOutput();
                NativeMessageProtocol.Write(output, NativeResponse.Error("HostError", exception.Message));
            }
            catch
            {
                // Chrome will report a broken native messaging host if stdout is unavailable.
            }

            return 1;
        }
    }

    private static async Task<NativeResponse> HandleRequestAsync(NativeRequest request, string[] args)
    {
        return request.Action switch
        {
            "status" => await GetStatusAsync().ConfigureAwait(false),
            "authenticate" => await AuthenticateAsync(request.Message, args).ConfigureAwait(false),
            _ => NativeResponse.Error("InvalidRequest", "Unknown native host action."),
        };
    }

    private static async Task<NativeResponse> GetStatusAsync()
    {
        UserConsentVerifierAvailability availability = await UserConsentVerifier.CheckAvailabilityAsync();
        return new NativeResponse(
            Ok: true,
            Available: availability == UserConsentVerifierAvailability.Available,
            Verified: false,
            Availability: availability.ToString(),
            Result: null,
            Message: AvailabilityMessage(availability));
    }

    private static async Task<NativeResponse> AuthenticateAsync(string? requestedMessage, string[] args)
    {
        UserConsentVerifierAvailability availability = await UserConsentVerifier.CheckAvailabilityAsync();
        if (availability != UserConsentVerifierAvailability.Available)
        {
            return new NativeResponse(
                Ok: false,
                Available: false,
                Verified: false,
                Availability: availability.ToString(),
                Result: "Unavailable",
                Message: AvailabilityMessage(availability));
        }

        string message = string.IsNullOrWhiteSpace(requestedMessage) ? DefaultPrompt : requestedMessage.Trim();
        if (message.Length > 160) message = message[..160];

        IntPtr chromeWindow = ParseParentWindow(args);
        using var fallbackOwner = chromeWindow == IntPtr.Zero ? new HiddenOwnerWindow() : null;
        IntPtr ownerWindow = chromeWindow != IntPtr.Zero ? chromeWindow : fallbackOwner!.Handle;

        UserConsentVerificationResult result = await UserConsentVerifierInterop
            .RequestVerificationForWindowAsync(ownerWindow, message);

        bool verified = result == UserConsentVerificationResult.Verified;
        return new NativeResponse(
            Ok: verified,
            Available: true,
            Verified: verified,
            Availability: availability.ToString(),
            Result: result.ToString(),
            Message: VerificationMessage(result));
    }

    private static IntPtr ParseParentWindow(IEnumerable<string> args)
    {
        const string prefix = "--parent-window=";
        string? value = args.FirstOrDefault(argument => argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
        if (value is null) return IntPtr.Zero;

        return long.TryParse(value[prefix.Length..], out long handle) && handle > 0
            ? new IntPtr(handle)
            : IntPtr.Zero;
    }

    private static string AvailabilityMessage(UserConsentVerifierAvailability availability) => availability switch
    {
        UserConsentVerifierAvailability.Available => "Windows Hello is available.",
        UserConsentVerifierAvailability.DeviceBusy => "The Windows Hello device is busy.",
        UserConsentVerifierAvailability.DeviceNotPresent => "No Windows Hello authentication device was found.",
        UserConsentVerifierAvailability.DisabledByPolicy => "Windows Hello verification is disabled by policy.",
        UserConsentVerifierAvailability.NotConfiguredForUser => "Set up Windows Hello for this Windows account first.",
        _ => "Windows Hello is currently unavailable.",
    };

    private static string VerificationMessage(UserConsentVerificationResult result) => result switch
    {
        UserConsentVerificationResult.Verified => "Windows Hello verified the current user.",
        UserConsentVerificationResult.DeviceBusy => "The Windows Hello device is busy.",
        UserConsentVerificationResult.DeviceNotPresent => "No Windows Hello authentication device was found.",
        UserConsentVerificationResult.DisabledByPolicy => "Windows Hello verification is disabled by policy.",
        UserConsentVerificationResult.NotConfiguredForUser => "Set up Windows Hello for this Windows account first.",
        UserConsentVerificationResult.RetriesExhausted => "Too many attempts were made. Try again later.",
        UserConsentVerificationResult.Canceled => "Windows Hello was canceled.",
        _ => "Windows Hello could not verify the current user.",
    };
}

internal sealed class HiddenOwnerWindow : NativeWindow, IDisposable
{
    public HiddenOwnerWindow()
    {
        CreateHandle(new CreateParams
        {
            Caption = "Chrome Hello Lock",
            X = -32_000,
            Y = -32_000,
            Width = 1,
            Height = 1,
        });
    }

    public void Dispose()
    {
        DestroyHandle();
    }
}

internal sealed record NativeRequest(string Action, string? Message);

internal sealed record NativeResponse(
    bool Ok,
    bool Available,
    bool Verified,
    string Availability,
    string? Result,
    string Message)
{
    public static NativeResponse Error(string result, string message) =>
        new(false, false, false, "Unknown", result, message);
}

internal static class NativeMessageProtocol
{
    private const int MaximumMessageBytes = 1024 * 1024;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static NativeRequest Read(Stream input)
    {
        Span<byte> lengthBytes = stackalloc byte[sizeof(int)];
        ReadExactly(input, lengthBytes);
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
