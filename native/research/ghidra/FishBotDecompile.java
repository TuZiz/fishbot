// Offline targeted decompilation. Does not attach to or modify WeChat.
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
public class FishBotDecompile extends GhidraScript {
 public void run() throws Exception {
  String[] args=getScriptArgs();
  ArrayList<Function> functions=new ArrayList<>();
  for(String line:Files.readAllLines(Path.of(args[0]))){
   String[] parts=line.trim().split("\\s+");if(parts.length!=2)continue;
   long rva=Long.parseUnsignedLong(parts[0],16),end=Long.parseUnsignedLong(parts[1],16);
   var startAddress=currentProgram.getImageBase().add(rva);
   var body=new AddressSet(startAddress,currentProgram.getImageBase().add(end-1));
   new DisassembleCommand(startAddress,body,true).applyTo(currentProgram,monitor);
   Function function=getFunctionAt(startAddress);
   if(function==null)function=currentProgram.getFunctionManager().createFunction("fishbot_"+parts[0],startAddress,body,SourceType.USER_DEFINED);
   functions.add(function);
  }
  DecompInterface decompiler=new DecompInterface();
  decompiler.openProgram(currentProgram);
  try{for(Function function:functions){
   var result=decompiler.decompileFunction(function,40,monitor);
   String content=result.decompileCompleted()?result.getDecompiledFunction().getC():result.getErrorMessage();
   Files.writeString(Path.of(args[1],function.getName()+".c"),content);
   println("FISHBOT_DECOMPILED "+function.getName());
  }}finally{decompiler.dispose();}
 }
}
