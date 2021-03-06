function onOpen() {
  
  UserProperties.deleteAllProperties();
  
  // Add a menu with some items, some separators, and a sub-menu.
  DocumentApp.getUi().createMenu('2Tex')
  .addItem('Convert to LaTex', 'convert')
  .addItem('Edit custom properties', 'custom')
  .addToUi();
}

function props(){
  var props = ["author", "subtitle"];
  for(var p in props){
    Logger.log(UserProperties.getKeys());
    if (UserProperties.getKeys().indexOf(props[p]) === -1) {
      Logger.log("y" + p);
      UserProperties.setProperty(props[p], DocumentApp.getUi().prompt('Enter your ' + props[p] + ' :').getResponseText());
    }
  }
}

function convert() {
  props();
  var doc = DocumentApp.getActiveDocument();
  //var author = DocumentApp.getUi().prompt('Enter your name:');
  var author = "om";
  var stuff = ConvertToMarkdown();

  //console.log(payload);
  var options = {
    "method": "post",
    "headers": {},
    "payload": {"doc": stuff, "author": UserProperties.getProperty("author"), "email":Session.getActiveUser().getEmail(), "subtitle":UserProperties.getProperty("subtitle")}
  };
  var url = "http://andrewbeveridge.co.uk/texgen/gen.php";
  var response = UrlFetchApp.fetch(url, options);
  //
  
  Logger.log(response.getContentText());
  var htmlOutput = HtmlService
     .createHtmlOutput('<a href="' + response.getContentText() + '" target="_blank">Your PDF, sir</a>')
     .setTitle('2Tex');
  DocumentApp.getUi().showDialog(htmlOutput);
}


function custom(){

 // Display a dialog box with custom UiApp content.
 var uiInstance = UiApp.createApplication()
     .setTitle('My 2Tex properties')
     .setWidth(250)
     .setHeight(300);
  var form = uiInstance.createFormPanel();
  var flow = uiInstance.createFlowPanel();
  
  for(var p in UserProperties.getProperties()){
    flow.add(uiInstance.createTextBox().setName(p));
  }
  form.add(flow);
  uiInstance.add(form);
  
 DocumentApp.getUi().showDialog(uiInstance);
}




function ConvertToMarkdown() {
  var numChildren = DocumentApp.getActiveDocument().getActiveSection().getNumChildren();
  var text = "";
  var inSrc = false;
  var inClass = false;
  var globalImageCounter = 0;
  var globalListCounters = {};
  
  var attachments = [];
  
  for (var i=0; i<numChildren; i++) {
    var child = DocumentApp.getActiveDocument().getActiveSection().getChild(i);
    var result = processParagraph(i, child, inSrc, globalImageCounter, globalListCounters);
    globalImageCounter += (result && result.images) ? result.images.length : 0;
    if (result!==null) {
      if (result.source==="start" && !inSrc) {
        inSrc=true;
        text+="<pre>\n";
      } else if (result.source==="end" && inSrc) {
        inSrc=false;
        text+="</pre>\n\n";
      } else if (result.inClass==="start" && !inClass) {
        inClass=true;
        text+="<div class=\""+result.className+"\">\n";
      } else if (result.inClass==="end" && inClass) {
        inClass=false;
        text+="</div>\n\n";
      } else if (inClass) {
        text+=result.text+"\n\n";
      } else if (inSrc) {
        text+=("    "+escapeHTML(result.text)+"\n");
      } else if (result.text && result.text.length>0) {
        text+=result.text+"\n\n";
      }
      
      if (result.images && result.images.length>0) {
        for (var j=0; j<result.images.length; j++) {
          attachments.push( {
            "fileName": result.images[j].name,
            "mimeType": result.images[j].type,
            "content": result.images[j].bytes } );
        }
      }
    } else if (inSrc) { // support empty lines inside source code
      text+='\n';
    }
      
  }
  
  return text;

}

function escapeHTML(text) {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function processParagraph(index, element, inSrc, imageCounter, listCounters) {
  if (element.getNumChildren()==0) {
    return null;
  }
  
  if (element.getType() === DocumentApp.ElementType.TABLE_OF_CONTENTS) {
    return {"text": "[[TOC]]"};
  }
  
  var result = {};

  var pOut = "";
  var textElements = [];
  var imagePrefix = "image_";
  
  for (var i=0; i<element.getNumChildren(); i++) {
    var t=element.getChild(i).getType();
    if (t === DocumentApp.ElementType.TEXT || t === DocumentApp.ElementType.TABLE_ROW) {
      // TODO: proper handling of table_row
      var txt=element.getChild(i);
      pOut += txt.getText();
      textElements.push(txt);
    } else if (t === DocumentApp.ElementType.INLINE_IMAGE) {
      result.images = result.images || [];
      var contentType = element.getChild(i).getBlob().getContentType();
      var extension = "";
      if (/\/png$/.test(contentType)) {
        extension = ".png";
      } else if (/\/gif$/.test(contentType)) {
        extension = ".gif";
      } else if (/\/jpe?g$/.test(contentType)) {
        extension = ".jpg";
      } else {
        throw "Unsupported image type: "+contentType;
      }
      var name = imagePrefix + imageCounter + extension;
      imageCounter++;
      textElements.push('![image alt text]('+name+')');
      result.images.push( {
        "bytes": element.getChild(i).getBlob().getBytes(), 
        "type": contentType, 
        "name": name});
    } else if (t === DocumentApp.ElementType.PAGE_BREAK) {
      // ignore
    } else if (t === DocumentApp.ElementType.HORIZONTAL_RULE) {
      textElements.push('* * *\n');
    } else if (t === DocumentApp.ElementType.FOOTNOTE) {
      textElements.push(' (NOTE: '+element.getChild(i).getFootnoteContents().getText()+')');
    } else {
      throw "Paragraph "+index+" of type "+element.getType()+" has an unsupported child: "+t+" "+(element.getChild(i)["getText"] ? element.getChild(i).getText():'')+" index="+index;
    }
  }

  if (textElements.length==0) {
    return result;
  }
  
  
  // process source code block:
  if (/^\s*---\s+source code\s*$/.test(pOut)) {
    result.source = "start";
  } else if (/^\s*---\s+class\s+([^ ]+)\s*$/.test(pOut)) {
    result.inClass = "start";
    result.className = RegExp.$1;
  } else if (/^\s*---\s*$/.test(pOut)) {
    result.source = "end";
    result.inClass = "end";
  } else if (/^\s*---\s+jsperf\s*([^ ]+)\s*$/.test(pOut)) {
    result.text = '<iframe style="width: 100%; height: 340px; overflow: hidden; border: 0;" '+
                  'src="http://www.html5rocks.com/static/jsperfview/embed.html?id='+RegExp.$1+
                  '"></iframe>';
  } else {

    prefix = findPrefix(inSrc, element, listCounters);
  
    var pOut = "";
    for (var i=0; i<textElements.length; i++) {
      pOut += processTextElement(inSrc, textElements[i]);
    }

    // replace Unicode quotation marks
    pOut = pOut.replace('\u201d', '"').replace('\u201c', '"');
 
    result.text = prefix+pOut;
  }
  
  return result;
}

function findPrefix(inSrc, element, listCounters) {
  var prefix="";
  if (!inSrc) {
    if (element.getType()===DocumentApp.ElementType.PARAGRAPH) {
      var paragraphObj = element;
      switch (paragraphObj.getHeading()) {
        case DocumentApp.ParagraphHeading.HEADING6: prefix+="#";
        case DocumentApp.ParagraphHeading.HEADING5: prefix+="#";
        case DocumentApp.ParagraphHeading.HEADING4: prefix+="#";
        case DocumentApp.ParagraphHeading.HEADING3: prefix+="#";
        case DocumentApp.ParagraphHeading.HEADING2: prefix+="#";
        case DocumentApp.ParagraphHeading.HEADING1: prefix+="# ";
        default:
      }
    } else if (element.getType()===DocumentApp.ElementType.LIST_ITEM) {
      var listItem = element;
      var nesting = listItem.getNestingLevel()
      for (var i=0; i<nesting; i++) {
        prefix += "    ";
      }
      var gt = listItem.getGlyphType();
      if (gt === DocumentApp.GlyphType.BULLET || gt === DocumentApp.GlyphType.HOLLOW_BULLET || 
          gt === DocumentApp.GlyphType.SQUARE_BULLET) {
        prefix += "* ";
      } else {
        var key = listItem.getListId() + '.' + listItem.getNestingLevel();
        var counter = listCounters[key] || 0;
        counter++;
        listCounters[key] = counter;
        prefix += counter+". ";
      }
    }
  }
  return prefix;
}

function processTextElement(inSrc, txt) {
  if (typeof(txt) === 'string') {
    return txt;
  }
  
  var pOut = txt.getText();
  if (! txt.getTextAttributeIndices) {
    return pOut;
  }
  
  var attrs=txt.getTextAttributeIndices();
  var lastOff=pOut.length;
  
  for (var i=attrs.length-1; i>=0; i--) {
    var off=attrs[i];
    var url=txt.getLinkUrl(off);
    var font=txt.getFontFamily(off);
    if (url) {  // start of link
      if (i>=1 && attrs[i-1]==off-1 && txt.getLinkUrl(attrs[i-1])===url) {
        // detect links that are in multiple pieces because of errors on formatting:
        i-=1;
        off=attrs[i];
        url=txt.getLinkUrl(off);
      }
      pOut=pOut.substring(0, off)+'['+pOut.substring(off, lastOff)+']('+url+')'+pOut.substring(lastOff);
    } else if (font) {
      if (!inSrc && font===font.COURIER_NEW) {
        while (i>=1 && txt.getFontFamily(attrs[i-1]) && txt.getFontFamily(attrs[i-1])===font.COURIER_NEW) {
          // detect fonts that are in multiple pieces because of errors on formatting:
          i-=1;
          off=attrs[i];
        }
        pOut=pOut.substring(0, off)+'`'+pOut.substring(off, lastOff)+'`'+pOut.substring(lastOff);
      }
    }
    if (txt.isBold(off)) {
      var d1 = d2 = "**";
      if (txt.isItalic(off)) {
        d1 = "** *"; d2 = "* **";
      }
      pOut=pOut.substring(0, off)+d1+pOut.substring(off, lastOff)+d2+pOut.substring(lastOff);
    } else if (txt.isItalic(off)) {
      pOut=pOut.substring(0, off)+'*'+pOut.substring(off, lastOff)+'*'+pOut.substring(lastOff);
    }
    lastOff=off;
  }
  return pOut;
}
