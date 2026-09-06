namespace Scada.OpcUa.Abstractions;

public interface IOpcUaSessionClientFactory
{
    IOpcUaSessionClient Create();
}
