// Standalone offline analysis: no process access, scripts framework or database writes.
import ghidra.GhidraApplicationLayout;
import ghidra.framework.Application;
import ghidra.framework.HeadlessGhidraApplicationConfiguration;
import ghidra.app.util.importer.ProgramLoader;
import ghidra.app.util.importer.MessageLog;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import ghidra.util.task.TaskMonitor;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;

public class FishBotOffline {
 public static void main(String[] args) throws Exception {
  Application.initializeApplication(new GhidraApplicationLayout(new File(args[0])),new HeadlessGhidraApplicationConfiguration());
  var builder=ProgramLoader.builder().source(new File(args[1])).log(new MessageLog()).monitor(TaskMonitor.DUMMY);
  boolean mapped=args[1].endsWith(".image");
  if(mapped)builder.loaders(ghidra.app.util.opinion.BinaryLoader.class).language("x86:LE:64:default").compiler("clangwindows");
  else builder.addLoaderArg("-loader-loadLibraries","false").addLoaderArg("-loader-linkExistingProjectLibraries","false");
  try(var loaded=builder.load()) {
   var program=loaded.getPrimary().getDomainObject();
   ArrayList<Function> functions=new ArrayList<>();
   int transaction=program.startTransaction("targeted offline decompilation");
   try {
    if(mapped)program.setImageBase(program.getAddressFactory().getDefaultAddressSpace().getAddress(0x180000000L),true);
    for(String line:Files.readAllLines(Path.of(args[2]))) {
     String[] parts=line.trim().split("\\s+"); if(parts.length!=2) continue;
     long start=Long.parseUnsignedLong(parts[0],16),end=Long.parseUnsignedLong(parts[1],16);
     var address=program.getImageBase().add(start);
     var body=new AddressSet(address,program.getImageBase().add(end-1));
     new DisassembleCommand(address,body,true).applyTo(program,TaskMonitor.DUMMY);
     var function=program.getFunctionManager().getFunctionAt(address);
     if(function==null)function=program.getFunctionManager().createFunction("fishbot_"+parts[0],address,body,SourceType.USER_DEFINED);
     functions.add(function);
    }
   } finally {program.endTransaction(transaction,true);}
   Files.createDirectories(Path.of(args[3]));
   var decompiler=new DecompInterface();
   try {
    if(!decompiler.openProgram(program))throw new IllegalStateException(decompiler.getLastMessage());
    for(var function:functions) {
     var result=decompiler.decompileFunction(function,40,TaskMonitor.DUMMY);
     if(!result.decompileCompleted())throw new IllegalStateException(function.getName()+": "+result.getErrorMessage());
     Files.writeString(Path.of(args[3],function.getName()+".c"),result.getDecompiledFunction().getC());
     System.out.println("DECOMPILED "+function.getName());
    }
   } finally {decompiler.dispose();}
  }
 }
}
